import express from "express";
import { receptionistReply, receptionistVoiceReply } from "./ai.js";
import { getMemory, addToMemory } from "./store.js";
import { twimlMessage } from "./twilio.js";
import { getCallMemory, addCallMemory } from "./callStore.js";
import { voiceResponse, voiceHangup } from "./voice.js";
import { buildBookingISO } from "./timeParser.js";
import { getSlots, mergeSlots, clearSlots } from "./slotStore.js";
import {
  getAuthUrl,
  setTokensFromCode,
  isGoogleConnected,
  createCalendarEvent,
} from "./calendar.js";

const router = express.Router();

// ---- CONFIG / CONSTANTS ----
const businessProfile = {
  businessName: "Demo Barbershop",
  hours: "Mon-Sat 10am-7pm",
  services: ["Haircut (30m)", "Beard trim (15m)", "Haircut+Beard (45m)"],
  location: "Thornton, CO",
};

// Track calls that have already successfully booked (avoid “booked” loops)
const bookedCall = new Set();

// Capture-mode (only used when parsing fails and we need exact date/time)
const awaitingExactDateTime = new Set(); // callSid waiting for exact date/time
const parseAttempts = new Map(); // callSid -> attempts

// Twilio sometimes retries webhooks; prevent duplicate calendar events
const lastBookedAt = new Map();
function recentlyBooked(key, windowMs = 60_000) {
  const now = Date.now();
  const last = lastBookedAt.get(key) || 0;
  if (now - last < windowMs) return true;
  lastBookedAt.set(key, now);
  return false;
}

function durationForService(service) {
  const s = (service || "").toLowerCase().replace(/\s+/g, "");
  if (s.includes("haircut+beard") || s.includes("haircutandbeard")) return 45;
  if (s.includes("beard")) return 15;
  return 30;
}

// Extract day/time directly from the user's speech when we ask:
// "Please say the exact date and time like: January 4 at 5 PM"
function extractDayTimeFromSpeech(speech) {
  const s = (speech || "").toLowerCase().trim();

  // supports: "2 pm", "2pm", "2:30 pm", "14:00"
  const timeMatch =
    s.match(/\b(\d{1,2}:\d{2}\s*(am|pm)?)\b/i) ||
    s.match(/\b(\d{1,2}\s*(am|pm))\b/i);

  if (!timeMatch) return null;

  const timeText = (timeMatch[1] || timeMatch[0] || "").replace(/\s+/g, "");
  const dayText = s
    .replace(timeMatch[0], "")
    .replace(/\b(at|on|for)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { dayText: dayText || s, timeText };
}

// Simple request logger
router.use((req, _res, next) => {
  console.log("➡️", req.method, req.path);
  next();
});

router.get("/health", (_req, res) => res.json({ ok: true }));

router.get("/test-ai", async (req, res) => {
  const msg = req.query.msg || "Hi";
  try {
    const ai = await receptionistReply({
      businessProfile,
      customerMessage: msg,
      memory: [],
    });
    res.json(ai);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- GOOGLE CALENDAR OAUTH ----
router.get("/auth/google", (_req, res) => res.redirect(getAuthUrl()));

router.get("/auth/google/callback", async (req, res) => {
  try {
    await setTokensFromCode(req.query.code);
    res.send("✅ Google Calendar connected. You can close this tab.");
  } catch (e) {
    res.status(500).send(`Auth error: ${e.message}`);
  }
});

router.get("/auth/google/status", (_req, res) => {
  res.json({ connected: isGoogleConnected() });
});

// Manual booking test
router.get("/test-book", async (_req, res) => {
  try {
    const startISO = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const endISO = new Date(Date.now() + 90 * 60 * 1000).toISOString();

    const evt = await createCalendarEvent({
      name: "Mahad",
      service: "Haircut",
      startISO,
      endISO,
      phone: "test",
    });

    res.json({ ok: true, eventId: evt.id, htmlLink: evt.htmlLink });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- SMS WEBHOOK ----
router.post("/webhook/sms", async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || "").trim();

  console.log("📩 SMS from:", from, "Message:", body);

  const memory = getMemory(from);
  addToMemory(from, `Customer: ${body}`);

  try {
    const ai = await receptionistReply({
      businessProfile,
      customerMessage: body,
      memory,
    });

    console.log("AI JSON:", ai);

    // Book if ready (server computes ISO)
    if (
      ai.intent === "book" &&
      ai.booking?.dayText &&
      ai.booking?.timeText &&
      ai.booking?.service &&
      ai.booking?.name
    ) {
      if (!isGoogleConnected()) {
        res
          .type("text/xml")
          .send(twimlMessage("I can’t book yet because the calendar isn’t connected."));
        return;
      }

      const durationMins = durationForService(ai.booking.service);
      const iso = buildBookingISO({
        dayText: ai.booking.dayText,
        timeText: ai.booking.timeText,
        durationMins,
      });

      if (!iso) {
        res
          .type("text/xml")
          .send(
            twimlMessage(
              'Got it — what exact date and time should I book? (Example: "January 4 at 5pm")'
            )
          );
        return;
      }

      if (!recentlyBooked(from)) {
        await createCalendarEvent({
          name: ai.booking.name,
          service: ai.booking.service,
          startISO: iso.startISO,
          endISO: iso.endISO,
          phone: from,
        });
      }

      res.type("text/xml").send(twimlMessage("✅ Perfect — your appointment is booked."));
      return;
    }

    res.type("text/xml").send(twimlMessage(ai.reply || "Okay."));
  } catch (e) {
    console.log("❌ SMS error:", e.message);
    res.type("text/xml").send(
      twimlMessage("Sorry — I’m having trouble right now. Please try again.")
    );
  }
});

// ---- VOICE WEBHOOKS ----

// Entry point
router.post("/webhook/voice", async (req, res) => {
  try {
    const callSid = req.body.CallSid;
    console.log("📞 Incoming call:", callSid);

    // reset per-call state
    awaitingExactDateTime.delete(callSid);
    parseAttempts.delete(callSid);
    bookedCall.delete(callSid);
    clearSlots(callSid);

    res.type("text/xml").send(
      voiceResponse({
        sayText: "Hi! Thanks for calling. I can help you book an appointment.",
        gatherAction: "/webhook/voice/continue",
        gatherPrompt: "What can I help you with?",
      })
    );
  } catch (e) {
    console.log("❌ /webhook/voice error:", e.message);
    res.type("text/xml").send(voiceHangup("Sorry, something went wrong."));
  }
});

// Continue step
router.post("/webhook/voice/continue", async (req, res) => {
  try {
    const callSid = req.body.CallSid;
    const speech = (req.body.SpeechResult || "").trim();
    const digit = (req.body.Digits || "").trim();

    console.log("🗣️ Speech:", speech, "🔢 Digits:", digit);

    // Trial “press any key”
    if (digit && !speech) {
      res.type("text/xml").send(
        voiceResponse({
          sayText: "Go ahead.",
          gatherAction: "/webhook/voice/continue",
          gatherPrompt: "",
        })
      );
      return;
    }

    // End call (always)
    if (/(bye|goodbye|thank you|thanks)/i.test(speech)) {
      const endText = bookedCall.has(callSid)
        ? "Perfect. See you then. Goodbye!"
        : "No problem. Goodbye!";
      res.type("text/xml").send(voiceHangup(endText));
      return;
    }

    if (!speech) {
      res.type("text/xml").send(
        voiceResponse({
          sayText: "Sorry, I didn’t catch that.",
          gatherAction: "/webhook/voice/continue",
          gatherPrompt: "Please say that again.",
        })
      );
      return;
    }

    const memory = getCallMemory(callSid);
    addCallMemory(callSid, `Caller: ${speech}`);

    // Current server-side slots (NEVER forget)
    const currentSlots = getSlots(callSid);

    // ---- CAPTURE MODE (only for exact date/time after parse fails) ----
    if (awaitingExactDateTime.has(callSid)) {
      const attempt = (parseAttempts.get(callSid) || 0) + 1;
      parseAttempts.set(callSid, attempt);

      const extracted = extractDayTimeFromSpeech(speech);

      const durationMins = durationForService(currentSlots.service || "Haircut");

      let iso = null;
      if (extracted) {
        iso = buildBookingISO({
          dayText: extracted.dayText,
          timeText: extracted.timeText,
          durationMins,
        });
      }

      if (!iso && attempt < 3) {
        res.type("text/xml").send(
          voiceResponse({
            sayText: 'Please say it like: "January 4 at 5 PM".',
            gatherAction: "/webhook/voice/continue",
            gatherPrompt: "",
          })
        );
        return;
      }

      if (!iso && attempt >= 3) {
        awaitingExactDateTime.delete(callSid);
        parseAttempts.delete(callSid);
        res
          .type("text/xml")
          .send(voiceHangup("Sorry — I’m having trouble understanding. Please try again later."));
        return;
      }

      // success -> clear capture mode and book
      awaitingExactDateTime.delete(callSid);
      parseAttempts.delete(callSid);

      if (!isGoogleConnected()) {
        res.type("text/xml").send(
          voiceResponse({
            sayText: "I can’t book yet because the calendar isn’t connected.",
            gatherAction: "/webhook/voice/continue",
            gatherPrompt: "Anything else?",
          })
        );
        return;
      }

      if (!recentlyBooked(callSid)) {
        await createCalendarEvent({
          name: currentSlots.name || "Customer",
          service: currentSlots.service || "Haircut",
          startISO: iso.startISO,
          endISO: iso.endISO,
          phone: callSid,
        });
      }

      bookedCall.add(callSid);

      res.type("text/xml").send(
        voiceResponse({
          sayText: "Perfect — your appointment is booked.",
          gatherAction: "/webhook/voice/continue",
          gatherPrompt: "Anything else?",
        })
      );
      return;
    }

    // ---- NORMAL AI FLOW ----
    const ai = await receptionistVoiceReply({
      businessProfile,
      customerMessage: speech,
      memory,
    });

    console.log("AI JSON:", ai);

    // Merge AI slots into server slots (never overwrite with empty)
    const merged = mergeSlots(callSid, ai.booking || {});
    console.log("🧩 Merged slots:", merged);

    const ready =
      merged.name && merged.service && merged.dayText && merged.timeText;

    // If we are in booking flow but missing info, ask deterministically (NOT AI)
    if (ai.intent === "book" && !ready) {
      let q = "One quick question—";
      if (!merged.name) q += "what’s your name?";
      else if (!merged.service)
        q += "which service: Haircut, Beard trim, or Haircut+Beard?";
      else if (!merged.dayText) q += "what day would you like?";
      else if (!merged.timeText) q += "what time works for you?";

      res.type("text/xml").send(
        voiceResponse({
          sayText: q,
          gatherAction: "/webhook/voice/continue",
          gatherPrompt: "",
        })
      );
      return;
    }

    // If ready -> deterministic booking
    if (ai.intent === "book" && ready) {
      if (!isGoogleConnected()) {
        res.type("text/xml").send(
          voiceResponse({
            sayText: "I can’t book yet because the calendar isn’t connected.",
            gatherAction: "/webhook/voice/continue",
            gatherPrompt: "Do you want to try again?",
          })
        );
        return;
      }

      const durationMins = durationForService(merged.service);
      const iso = buildBookingISO({
        dayText: merged.dayText,
        timeText: merged.timeText,
        durationMins,
      });

      if (!iso) {
        // Enter capture mode
        awaitingExactDateTime.add(callSid);
        parseAttempts.set(callSid, 0);

        res.type("text/xml").send(
          voiceResponse({
            sayText: 'Got it — please say the exact date and time like: "January 4 at 5 PM".',
            gatherAction: "/webhook/voice/continue",
            gatherPrompt: "",
          })
        );
        return;
      }

      if (!recentlyBooked(callSid)) {
        await createCalendarEvent({
          name: merged.name,
          service: merged.service,
          startISO: iso.startISO,
          endISO: iso.endISO,
          phone: callSid,
        });
      }

      bookedCall.add(callSid);

      res.type("text/xml").send(
        voiceResponse({
          sayText: "Perfect — your appointment is booked.",
          gatherAction: "/webhook/voice/continue",
          gatherPrompt: "Anything else?",
        })
      );
      return;
    }

    // Non-booking intent -> just speak AI reply
    addCallMemory(callSid, `AI: ${ai.reply || ""}`);

    res.type("text/xml").send(
      voiceResponse({
        sayText: ai.reply || "Okay.",
        gatherAction: "/webhook/voice/continue",
        gatherPrompt: "Go ahead.",
      })
    );
  } catch (e) {
    console.log("❌ Voice continue error:", e.message);
    res.type("text/xml").send(
      voiceResponse({
        sayText: "Sorry, I’m having trouble right now.",
        gatherAction: "/webhook/voice/continue",
        gatherPrompt: "Please try again.",
      })
    );
  }
});

export default router;
