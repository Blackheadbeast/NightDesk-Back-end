import express from "express";
import { receptionistReply, receptionistVoiceReply } from "./ai.js";
import { getMemory, addToMemory } from "./store.js";
import { twimlMessage } from "./twilio.js";
import { getCallMemory, addCallMemory } from "./callStore.js";
import { voiceResponse, voiceHangup } from "./voice.js";
import { buildBookingISO } from "./timeParser.js";
import {
  getAuthUrl,
  setTokensFromCode,
  isGoogleConnected,
  createCalendarEvent,
} from "./calendar.js";

const router = express.Router();

// --- loop-prevention / capture-mode state ---
const awaitingExactDateTime = new Set(); // callSid waiting for exact date/time
const parseAttempts = new Map(); // callSid -> attempts

// ---- CONFIG / CONSTANTS ----
const businessProfile = {
  businessName: "Demo Barbershop",
  hours: "Mon-Sat 10am-7pm",
  services: ["Haircut (30m)", "Beard trim (15m)", "Haircut+Beard (45m)"],
  location: "Thornton, CO",
};

// Track calls that have already successfully booked (avoid “booked” loops)
const bookedCall = new Set();

// Simple in-memory anti-duplicate booking guard (Twilio retries sometimes)
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

// Extract day/time directly from the user's speech when we ask
// "Please say the exact date and time like: December 25 at 2 PM"
function extractDayTimeFromSpeech(speech) {
  const s = (speech || "").toLowerCase().trim();

  // supports: "2 pm", "2pm", "2:30 pm", "14:00"
  const timeMatch =
    s.match(/\b(\d{1,2}:\d{2}\s*(am|pm)?)\b/i) ||
    s.match(/\b(\d{1,2}\s*(am|pm))\b/i) ||
    s.match(/\b(\d{1,2})\b/i); // last resort hour only

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
          .send(
            twimlMessage("I can’t book yet because the calendar isn’t connected.")
          );
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
              'Got it — what exact date and time should I book? (Example: "12/25 at 2pm")'
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

      const confirmation = `${ai.reply}\n✅ Your appointment is booked.`;
      res.type("text/xml").send(twimlMessage(confirmation));
      return;
    }

    res.type("text/xml").send(twimlMessage(ai.reply));
  } catch (e) {
    console.log("❌ SMS error:", e.message);
    res
      .type("text/xml")
      .send(twimlMessage("Sorry — I’m having trouble right now. Please try again."));
  }
});

// ---- VOICE WEBHOOKS ----

// Entry point
router.post("/webhook/voice", async (req, res) => {
  try {
    const callSid = req.body.CallSid;
    console.log("📞 Incoming call:", callSid);

    const twiml = voiceResponse({
      sayText: "Hi! Thanks for calling. I can help you book an appointment.",
      gatherAction: "/webhook/voice/continue",
      gatherPrompt: "Please tell me what you need.",
    });

    res.type("text/xml").send(twiml);
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
      const twiml = voiceResponse({
        sayText: "Go ahead.",
        gatherAction: "/webhook/voice/continue",
        gatherPrompt: "",
      });
      res.type("text/xml").send(twiml);
      return;
    }

    // End call
    if (/(bye|goodbye|thank you|thanks)/i.test(speech)) {
      const endText = bookedCall.has(callSid)
        ? "Perfect. See you then. Goodbye!"
        : "No problem. Goodbye!";
      res.type("text/xml").send(voiceHangup(endText));
      return;
    }

    if (!speech) {
      const twiml = voiceResponse({
        sayText: "Sorry, I didn’t catch that.",
        gatherAction: "/webhook/voice/continue",
        gatherPrompt: "Please say that again.",
      });
      res.type("text/xml").send(twiml);
      return;
    }

    const memory = getCallMemory(callSid);

    // ✅ Capture-mode: parse exact date/time DIRECTLY from speech (no AI),
    // to prevent infinite loops when the parser can't handle AI's dayText/timeText.
    if (awaitingExactDateTime.has(callSid)) {
      const attempt = (parseAttempts.get(callSid) || 0) + 1;
      parseAttempts.set(callSid, attempt);

      const extracted = extractDayTimeFromSpeech(speech);

      const lastServiceLine =
        [...memory].reverse().find((l) => l.startsWith("LastService:")) || "";
      const lastService = lastServiceLine.replace("LastService:", "").trim();
      const durationMins = durationForService(lastService || "haircut");

      let iso = null;
      if (extracted) {
        iso = buildBookingISO({
          dayText: extracted.dayText,
          timeText: extracted.timeText,
          durationMins,
        });
      }

      if (!iso && attempt < 2) {
        const twiml = voiceResponse({
          sayText: 'Sorry — please say it like: "December 25 at 2 PM".',
          gatherAction: "/webhook/voice/continue",
          gatherPrompt: "",
        });
        res.type("text/xml").send(twiml);
        return;
      }

      if (!iso && attempt >= 2) {
        awaitingExactDateTime.delete(callSid);
        parseAttempts.delete(callSid);
        res
          .type("text/xml")
          .send(
            voiceHangup(
              "Sorry—I'm having trouble understanding. Please try again later."
            )
          );
        return;
      }

      // success: clear mode and book using stored name/service
      awaitingExactDateTime.delete(callSid);
      parseAttempts.delete(callSid);

      const lastNameLine =
        [...memory].reverse().find((l) => l.startsWith("LastName:")) || "";
      const name = lastNameLine.replace("LastName:", "").trim() || "Customer";
      const service = lastService || "Haircut";

      if (!isGoogleConnected()) {
        const twiml = voiceResponse({
          sayText: "I can’t book yet because the calendar isn’t connected.",
          gatherAction: "/webhook/voice/continue",
          gatherPrompt: "Anything else?",
        });
        res.type("text/xml").send(twiml);
        return;
      }

      if (!recentlyBooked(callSid)) {
        await createCalendarEvent({
          name,
          service,
          startISO: iso.startISO,
          endISO: iso.endISO,
          phone: callSid,
        });
      }

      bookedCall.add(callSid);

      const twiml = voiceResponse({
        sayText: "Perfect. Your appointment is booked.",
        gatherAction: "/webhook/voice/continue",
        gatherPrompt: "Anything else?",
      });
      res.type("text/xml").send(twiml);
      return;
    }

    // Normal flow: AI
    addCallMemory(callSid, `Caller: ${speech}`);

    const ai = await receptionistVoiceReply({
      businessProfile,
      customerMessage: speech,
      memory,
    });

    console.log("AI JSON:", ai);

    // Deterministic booking
    if (
      ai.intent === "book" &&
      ai.booking?.dayText &&
      ai.booking?.timeText &&
      ai.booking?.service &&
      ai.booking?.name
    ) {
      // Save name/service so capture-mode can book even if parsing fails
      addCallMemory(callSid, `LastName: ${ai.booking.name}`);
      addCallMemory(callSid, `LastService: ${ai.booking.service}`);

      if (!isGoogleConnected()) {
        const twiml = voiceResponse({
          sayText: "I can’t book yet because the calendar isn’t connected.",
          gatherAction: "/webhook/voice/continue",
          gatherPrompt: "Do you want to try again?",
        });
        res.type("text/xml").send(twiml);
        return;
      }

      const durationMins = durationForService(ai.booking.service);
      const iso = buildBookingISO({
        dayText: ai.booking.dayText,
        timeText: ai.booking.timeText,
        durationMins,
      });

      // If parsing failed, enter capture mode (prevents infinite loops)
      if (!iso) {
        awaitingExactDateTime.add(callSid);
        parseAttempts.set(callSid, 0);

        const twiml = voiceResponse({
          sayText:
            'Got it — please say the exact date and time like: "December 25 at 2 PM".',
          gatherAction: "/webhook/voice/continue",
          gatherPrompt: "",
        });
        res.type("text/xml").send(twiml);
        return;
      }

      if (!recentlyBooked(callSid)) {
        await createCalendarEvent({
          name: ai.booking.name,
          service: ai.booking.service,
          startISO: iso.startISO,
          endISO: iso.endISO,
          phone: callSid,
        });
      }

      bookedCall.add(callSid);

      const twiml = voiceResponse({
        sayText: `${ai.reply}. Your appointment is booked.`,
        gatherAction: "/webhook/voice/continue",
        gatherPrompt: "Anything else?",
      });

      res.type("text/xml").send(twiml);
      return;
    }

    addCallMemory(callSid, `AI: ${ai.reply}`);

    const twiml = voiceResponse({
      sayText: ai.reply,
      gatherAction: "/webhook/voice/continue",
      gatherPrompt: "Go ahead.",
    });

    res.type("text/xml").send(twiml);
  } catch (e) {
    console.log("❌ Voice continue error:", e.message);
    const twiml = voiceResponse({
      sayText: "Sorry, I’m having trouble right now.",
      gatherAction: "/webhook/voice/continue",
      gatherPrompt: "Please try again.",
    });
    res.type("text/xml").send(twiml);
  }
});

export default router;
