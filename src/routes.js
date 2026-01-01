import express from "express";
import { twimlMessage } from "./twilio.js";
import { voiceResponse, voiceHangup } from "./voice.js";
import { receptionistReply, receptionistVoiceReply } from "./ai.js";
import { getMemory, addToMemory } from "./store.js";
import { getCallMemory, addCallMemory } from "./callStore.js";

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
    const from = req.body.From || "unknown";
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

    addToMemory(from, `AI: ${ai.reply}`);

    res.type("text/xml").send(
      twimlMessage(ai.reply || "Thanks! We’ll get back to you shortly.")
    );
  } catch (err) {
    console.error("SMS webhook error:", err);
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
          sayText: "Sorry, I didn’t catch that. Could you repeat?",
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
