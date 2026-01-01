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
  createCalendarEvent,
} from "./calendar.js";

const router = express.Router();

/* ================================
   ASYNC SAFETY (IMPORTANT)
================================ */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/* ================================
   CONFIG
================================ */
const businessProfile = {
  businessName: "NightDesk Demo",
  hours: "Mon–Sat 10am–7pm",
  services: ["Haircut (30m)", "Beard trim (15m)", "Haircut+Beard (45m)"],
  location: "Thornton, CO",
};

const bookedCall = new Set();
const awaitingExactDateTime = new Set();
const parseAttempts = new Map();
const lastBookedAt = new Map();

/* ================================
   HELPERS
================================ */
function recentlyBooked(key, windowMs = 60_000) {
  const now = Date.now();
  const last = lastBookedAt.get(key) || 0;
  if (now - last < windowMs) return true;
  lastBookedAt.set(key, now);
  return false;
}

function durationForService(service) {
  const s = (service || "").toLowerCase();
  if (s.includes("haircut+beard")) return 45;
  if (s.includes("beard")) return 15;
  return 30;
}

/* ================================
   LOGGING
================================ */
router.use((req, _res, next) => {
  console.log("➡️", req.method, req.path);
  next();
});

/* ================================
   GOOGLE AUTH
================================ */
router.get("/auth/google", (_req, res) => res.redirect(getAuthUrl()));

router.get(
  "/auth/google/callback",
  asyncHandler(async (req, res) => {
    await setTokensFromCode(req.query.code);
    res.send("✅ Google Calendar connected. You can close this tab.");
  })
);

/* ================================
   SMS WEBHOOK
================================ */
router.post(
  "/webhook/sms",
  asyncHandler(async (req, res) => {
    const from = req.body.From;
    const body = (req.body.Body || "").trim();

    const memory = getMemory(from);
    addToMemory(from, `Customer: ${body}`);

    const ai = await receptionistReply({
      businessProfile,
      customerMessage: body,
      memory,
    });

    if (
      ai.intent === "book" &&
      ai.booking?.name &&
      ai.booking?.service &&
      ai.booking?.dayText &&
      ai.booking?.timeText
    ) {
      const durationMins = durationForService(ai.booking.service);
      const iso = buildBookingISO({
        dayText: ai.booking.dayText,
        timeText: ai.booking.timeText,
        durationMins,
      });

      if (!iso) {
        res.type("text/xml").send(
          twimlMessage("What exact date and time should I book?")
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

      res
        .type("text/xml")
        .send(
          twimlMessage(
            "✅ Your appointment is booked. You'll receive a confirmation text shortly."
          )
        );
      return;
    }

    res.type("text/xml").send(twimlMessage(ai.reply || "Okay."));
  })
);

/* ================================
   VOICE ENTRY
================================ */
router.post(
  "/webhook/voice",
  asyncHandler(async (req, res) => {
    const callSid = req.body.CallSid;
    const callerNumber = req.body.From;

    awaitingExactDateTime.delete(callSid);
    parseAttempts.delete(callSid);
    bookedCall.delete(callSid);
    clearSlots(callSid);

    res.type("text/xml").send(
      voiceResponse({
        sayText:
          "Hi, thanks for calling NightDesk. I'm an AI receptionist. How can I help today?",
        gatherAction: "/webhook/voice/continue",
        gatherPrompt: "",
      })
    );
  })
);

/* ================================
   VOICE CONTINUE
================================ */
router.post(
  "/webhook/voice/continue",
  asyncHandler(async (req, res) => {
    const callSid = req.body.CallSid;
    const callerNumber = req.body.From;
    const speech = (req.body.SpeechResult || "").trim();

    if (!speech) {
      res.type("text/xml").send(
        voiceResponse({
          sayText: "Sorry, could you repeat that?",
          gatherAction: "/webhook/voice/continue",
          gatherPrompt: "",
        })
      );
      return;
    }

    if (/(bye|goodbye|thanks)/i.test(speech)) {
      res.type("text/xml").send(
        voiceHangup(
          bookedCall.has(callSid)
            ? "Your appointment is confirmed. Goodbye!"
            : "Okay. Have a great day!"
        )
      );
      return;
    }

    const memory = getCallMemory(callSid);
    addCallMemory(callSid, `Caller: ${speech}`);

    const currentSlots = getSlots(callSid);
    const contextPrompt = buildContextPrompt(currentSlots, speech);

    const ai = await receptionistVoiceReply({
      businessProfile,
      customerMessage: contextPrompt,
      memory,
    });

    const merged = mergeSlots(callSid, ai.booking || {});
    const ready =
      merged.name && merged.service && merged.dayText && merged.timeText;

    if (ai.intent === "book" && !ready) {
      let question = "";
      if (!merged.name) question = "What's your name?";
      else if (!merged.service) question = "Which service would you like?";
      else if (!merged.dayText) question = "What day works for you?";
      else if (!merged.timeText)
        question = `What time on ${merged.dayText}?`;

      addCallMemory(callSid, `AI: ${question}`);

      res.type("text/xml").send(
        voiceResponse({
          sayText: question,
          gatherAction: "/webhook/voice/continue",
          gatherPrompt: "",
        })
      );
      return;
    }

    if (ai.intent === "book" && ready) {
      const durationMins = durationForService(merged.service);
      const iso = buildBookingISO({
        dayText: merged.dayText,
        timeText: merged.timeText,
        durationMins,
      });

      if (!iso) {
        res.type("text/xml").send(
          voiceResponse({
            sayText:
              "Please say the full date and time, like January 4th at 5 PM.",
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
          phone: callerNumber,
        });
      }

      bookedCall.add(callSid);

      res.type("text/xml").send(
        voiceResponse({
          sayText:
            "Perfect. Your appointment is booked. You'll receive a text confirmation shortly. Anything else I can help with?",
          gatherAction: "/webhook/voice/continue",
          gatherPrompt: "",
        })
      );
      return;
    }

    res.type("text/xml").send(
      voiceResponse({
        sayText: ai.reply || "How else can I help?",
        gatherAction: "/webhook/voice/continue",
        gatherPrompt: "",
      })
    );
  })
);

function buildContextPrompt(slots, speech) {
  const collected = [];
  if (slots.name) collected.push(`name: ${slots.name}`);
  if (slots.service) collected.push(`service: ${slots.service}`);
  if (slots.dayText) collected.push(`day: ${slots.dayText}`);
  if (slots.timeText) collected.push(`time: ${slots.timeText}`);

  if (!collected.length) return speech;

  return `[Already collected: ${collected.join(
    ", "
  )}]\nCustomer said: ${speech}`;
}

export default router;
