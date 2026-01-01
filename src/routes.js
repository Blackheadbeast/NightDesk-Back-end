import express from "express";
import { twimlMessage } from "./twilio.js";
import { voiceResponse, voiceHangup } from "./voice.js";
import { receptionistReply, receptionistVoiceReply } from "./ai.js";
import { getMemory, addToMemory } from "./store.js";
import { getCallMemory, addCallMemory } from "./callStore.js";
import { getSlots, mergeSlots, clearSlots } from "./slotStore.js";
import { buildBookingISO } from "./timeParser.js";
import { createCalendarEvent } from "./calendar.js";

console.log("🔥 routes.js loaded");

const router = express.Router();

/* ================================
   TEST ROUTE (KEEP FOREVER)
================================ */
router.get("/test-route", (_req, res) => {
  res.json({ ok: true });
});

/* ================================
   HEALTH (OPTIONAL)
================================ */
router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

/* ================================
   SMS WEBHOOK
================================ */
router.post("/webhook/sms", async (req, res) => {
  try {
    const from = req.body.From; // phone number = session key
    const body = (req.body.Body || "").trim();

    const memory = getMemory(from);
    addToMemory(from, `Customer: ${body}`);

    const ai = await receptionistReply({
      businessProfile: {
        businessName: "NightDesk Demo",
        hours: "Mon–Sat 10am–7pm",
        services: ["Haircut", "Beard Trim", "Haircut & Beard"],
      },
      customerMessage: body,
      memory,
    });

    // 🔑 merge extracted booking data
    const merged = mergeSlots(from, ai.booking || {});

    let reply = ai.reply;

    // Ask ONE missing thing only
    if (ai.intent === "book") {
      if (!merged.name) reply = "Great! What's your name?";
      else if (!merged.service) reply = "Which service would you like?";
      else if (!merged.dayText) reply = "What day works best?";
      else if (!merged.timeText) reply = `What time on ${merged.dayText}?`;
      else {
        // All info collected → confirmation
        reply = `Thanks ${merged.name}! You're booking a ${merged.service} on ${merged.dayText} at ${merged.timeText}. Reply YES to confirm.`;
      }
    }

    // Final confirmation - CREATE CALENDAR EVENT
    if (/^yes$/i.test(body) && merged.dayText && merged.timeText) {
      try {
        const isoTimes = buildBookingISO({
          dayText: merged.dayText,
          timeText: merged.timeText,
          durationMins: 30,
        });

        if (isoTimes) {
          await createCalendarEvent({
            name: merged.name,
            service: merged.service,
            startISO: isoTimes.startISO,
            endISO: isoTimes.endISO,
            phone: from,
          });
          
          reply = `✅ Your ${merged.service} is booked for ${merged.dayText} at ${merged.timeText}. Check your email for confirmation!`;
        } else {
          reply = `✅ Your ${merged.service} is booked for ${merged.dayText} at ${merged.timeText}.`;
        }
      } catch (calError) {
        console.error("Calendar creation error:", calError);
        reply = `✅ Your ${merged.service} is booked for ${merged.dayText} at ${merged.timeText}.`;
      }
      
      clearSlots(from);
    }

    addToMemory(from, `AI: ${reply}`);

    res.type("text/xml").send(twimlMessage(reply));
  } catch (err) {
    console.error("SMS error:", err);
    res.type("text/xml").send(
      twimlMessage("Sorry, something went wrong. Please try again.")
    );
  }
});

/* ================================
   VOICE ENTRY
================================ */
router.post("/webhook/voice", (_req, res) => {
  res.type("text/xml").send(
    voiceResponse({
      sayText:
        "Hi, thanks for calling NightDesk. I can help book appointments or answer questions. How can I help?",
      gatherAction: "/api/webhook/voice/continue",
      gatherPrompt: "",
    })
  );
});

/* ================================
   VOICE CONTINUE
================================ */
router.post("/webhook/voice/continue", async (req, res) => {
  try {
    const callSid = req.body.CallSid;
    const speech = (req.body.SpeechResult || "").trim();

    if (!speech) {
      res.type("text/xml").send(
        voiceResponse({
          sayText: "Sorry, I didn't catch that. Could you repeat?",
          gatherAction: "/api/webhook/voice/continue",
          gatherPrompt: "",
        })
      );
      return;
    }

    if (/(bye|goodbye|thanks|thank you)/i.test(speech)) {
      res.type("text/xml").send(
        voiceHangup("Thanks for calling. Have a great day!")
      );
      return;
    }

    const memory = getCallMemory(callSid);
    addCallMemory(callSid, `Caller: ${speech}`);

    const ai = await receptionistVoiceReply({
      businessProfile: {
        businessName: "NightDesk Demo",
        hours: "Mon–Sat 10am–7pm",
        services: ["Haircut", "Beard Trim", "Haircut & Beard"],
      },
      customerMessage: speech,
      memory,
    });

    addCallMemory(callSid, `AI: ${ai.reply}`);

    res.type("text/xml").send(
      voiceResponse({
        sayText: ai.reply || "How else can I help?",
        gatherAction: "/api/webhook/voice/continue",
        gatherPrompt: "",
      })
    );
  } catch (err) {
    console.error("Voice webhook error:", err);
    res.type("text/xml").send(
      voiceHangup("Sorry, something went wrong. Please call again later.")
    );
  }
});

export default router;