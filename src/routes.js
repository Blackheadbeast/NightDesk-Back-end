//import express from "express";
// import { receptionistReply, receptionistVoiceReply } from "./ai.js";
// import { getMemory, addToMemory } from "./store.js";
// import { twimlMessage } from "./twilio.js";
// import { getCallMemory, addCallMemory } from "./callStore.js";
// import { voiceResponse, voiceHangup } from "./voice.js";
// import { buildBookingISO } from "./timeParser.js";
// import { getSlots, mergeSlots, clearSlots } from "./slotStore.js";
// import {
//   getAuthUrl,
//   setTokensFromCode,
//   isGoogleConnected,
//   createCalendarEvent,
// } from "./calendar.js";

// const router = express.Router();

// /* ================================
//    CONFIG
// ================================ */
// const businessProfile = {
//   businessName: "NightDesk Demo",
//   hours: "Mon–Sat 10am–7pm",
//   services: ["Haircut (30m)", "Beard trim (15m)", "Haircut+Beard (45m)"],
//   location: "Thornton, CO",
// };

// const bookedCall = new Set();
// const awaitingExactDateTime = new Set();
// const parseAttempts = new Map();
// const lastBookedAt = new Map();

// /* ================================
//    HELPERS
// ================================ */
// function recentlyBooked(key, windowMs = 60_000) {
//   const now = Date.now();
//   const last = lastBookedAt.get(key) || 0;
//   if (now - last < windowMs) return true;
//   lastBookedAt.set(key, now);
//   return false;
// }

// function durationForService(service) {
//   const s = (service || "").toLowerCase();
//   if (s.includes("haircut+beard") || s.includes("haircut and beard")) return 45;
//   if (s.includes("beard")) return 15;
//   return 30;
// }

// function extractDayTimeFromSpeech(speech) {
//   const s = (speech || "").toLowerCase();
//   const timeMatch =
//     s.match(/\b(\d{1,2}:\d{2}\s*(am|pm))\b/i) ||
//     s.match(/\b(\d{1,2}\s*(am|pm))\b/i);

//   if (!timeMatch) return null;

//   const timeText = timeMatch[1].replace(/\s+/g, "");
//   const dayText = s
//     .replace(timeMatch[0], "")
//     .replace(/\b(at|on|for)\b/g, " ")
//     .trim();

//   return { dayText, timeText };
// }

// /* ================================
//    LOGGING
// ================================ */
// router.use((req, _res, next) => {
//   console.log("➡️", req.method, req.path);
//   next();
// });

// /* ================================
//    HEALTH
// ================================ */
// router.get("/health", (_req, res) => res.json({ ok: true }));

// /* ================================
//    GOOGLE AUTH
// ================================ */
// router.get("/auth/google", (_req, res) => res.redirect(getAuthUrl()));

// router.get("/auth/google/callback", async (req, res) => {
//   try {
//     await setTokensFromCode(req.query.code);
//     res.send("✅ Google Calendar connected. You can close this tab.");
//   } catch (e) {
//     res.status(500).send(`Auth error: ${e.message}`);
//   }
// });

// /* ================================
//    SMS WEBHOOK
// ================================ */
// router.post("/webhook/sms", async (req, res) => {
//   const from = req.body.From;
//   const body = (req.body.Body || "").trim();

//   const memory = getMemory(from);
//   addToMemory(from, `Customer: ${body}`);

//   try {
//     const ai = await receptionistReply({
//       businessProfile,
//       customerMessage: body,
//       memory,
//     });

//     if (
//       ai.intent === "book" &&
//       ai.booking?.name &&
//       ai.booking?.service &&
//       ai.booking?.dayText &&
//       ai.booking?.timeText
//     ) {
//       const durationMins = durationForService(ai.booking.service);
//       const iso = buildBookingISO({
//         dayText: ai.booking.dayText,
//         timeText: ai.booking.timeText,
//         durationMins,
//       });

//       if (!iso) {
//         res.type("text/xml").send(
//           twimlMessage("What exact date and time should I book?")
//         );
//         return;
//       }

//       if (!recentlyBooked(from)) {
//         await createCalendarEvent({
//           name: ai.booking.name,
//           service: ai.booking.service,
//           startISO: iso.startISO,
//           endISO: iso.endISO,
//           phone: from,
//         });
//       }

//       res
//         .type("text/xml")
//         .send(twimlMessage("✅ Your appointment is booked. You'll receive a confirmation text shortly."));
//       return;
//     }

//     res.type("text/xml").send(twimlMessage(ai.reply || "Okay."));
//   } catch (e) {
//     console.error("SMS error:", e);
//     res
//       .type("text/xml")
//       .send(twimlMessage("Sorry, something went wrong. Please try again."));
//   }
// });

// /* ================================
//    VOICE ENTRY
// ================================ */
// router.post("/webhook/voice", async (req, res) => {
//   const callSid = req.body.CallSid;
//   const callerNumber = req.body.From; // ✅ Store caller's actual phone number

//   console.log(`📞 New call: ${callSid} from ${callerNumber}`);

//   // Reset state for new call
//   awaitingExactDateTime.delete(callSid);
//   parseAttempts.delete(callSid);
//   bookedCall.delete(callSid);
//   clearSlots(callSid);

//   res.type("text/xml").send(
//     voiceResponse({
//       sayText:
//         "Hi, thanks for calling NightDesk. I'm an AI receptionist. I can book appointments, answer questions, or take a message. How can I help today?",
//       gatherAction: "/webhook/voice/continue",
//       gatherPrompt: "",
//     })
//   );
// });

// /* ================================
//    VOICE CONTINUE
// ================================ */
// router.post("/webhook/voice/continue", async (req, res) => {
//   const callSid = req.body.CallSid;
//   const callerNumber = req.body.From; // ✅ Get actual phone number
//   const speech = (req.body.SpeechResult || "").trim();

//   console.log(`🗣️ ${callSid}: "${speech}"`);

//   if (!speech) {
//     res.type("text/xml").send(
//       voiceResponse({
//         sayText: "Sorry, I didn't catch that. Could you repeat that?",
//         gatherAction: "/webhook/voice/continue",
//         gatherPrompt: "",
//       })
//     );
//     return;
//   }

//   // Goodbye handling
//   if (/(bye|thank you|thanks|goodbye|that's all|that's it|no thanks)/i.test(speech)) {
//     res.type("text/xml").send(
//       voiceHangup(
//         bookedCall.has(callSid)
//           ? "Your appointment is confirmed. You'll receive a text confirmation shortly. Have a great day!"
//           : "Okay. Have a great day!"
//       )
//     );
//     return;
//   }

//   // Get existing conversation memory
//   const memory = getCallMemory(callSid);
//   addCallMemory(callSid, `Caller: ${speech}`);

//   // Get what we've collected so far
//   const currentSlots = getSlots(callSid);
  
//   // ✅ KEY FIX: Build enhanced context that tells AI what we already have
//   const contextPrompt = buildContextPrompt(currentSlots, speech);
  
//   const ai = await receptionistVoiceReply({
//     businessProfile,
//     customerMessage: contextPrompt,
//     memory,
//   });

//   // ✅ Merge AI's response with what we already have
//   const merged = mergeSlots(callSid, ai.booking || {});
  
//   console.log(`📋 Current booking state:`, merged);

//   const ready =
//     merged.name && merged.service && merged.dayText && merged.timeText;

//   // If booking intent but not all info collected
//   if (ai.intent === "book" && !ready) {
//     let question = "";
    
//     // ✅ Ask for ONE missing piece at a time
//     if (!merged.name) {
//       question = "Great! What's your name?";
//     } else if (!merged.service) {
//       question = `Perfect, ${merged.name}. Which service would you like? We offer haircuts, beard trims, or both.`;
//     } else if (!merged.dayText) {
//       question = `Awesome. What day works best for you?`;
//     } else if (!merged.timeText) {
//       question = `And what time on ${merged.dayText}?`;
//     }

//     addCallMemory(callSid, `AI: ${question}`);

//     res.type("text/xml").send(
//       voiceResponse({
//         sayText: question,
//         gatherAction: "/webhook/voice/continue",
//         gatherPrompt: "",
//       })
//     );
//     return;
//   }

//   // If all info collected, try to book
//   if (ai.intent === "book" && ready) {
//     const durationMins = durationForService(merged.service);
//     const iso = buildBookingISO({
//       dayText: merged.dayText,
//       timeText: merged.timeText,
//       durationMins,
//     });

//     if (!iso) {
//       const attempts = (parseAttempts.get(callSid) || 0) + 1;
//       parseAttempts.set(callSid, attempts);

//       if (attempts > 2) {
//         res.type("text/xml").send(
//           voiceHangup(
//             "I'm having trouble understanding the date and time. Please call back or text us to book. Goodbye."
//           )
//         );
//         return;
//       }

//       awaitingExactDateTime.add(callSid);
//       res.type("text/xml").send(
//         voiceResponse({
//           sayText: 'I need the full date and time. Please say it like "January 4th at 5 PM".',
//           gatherAction: "/webhook/voice/continue",
//           gatherPrompt: "",
//         })
//       );
//       return;
//     }

//     // ✅ Book with actual phone number, not CallSid
//     if (!recentlyBooked(callSid)) {
//       try {
//         await createCalendarEvent({
//           name: merged.name,
//           service: merged.service,
//           startISO: iso.startISO,
//           endISO: iso.endISO,
//           phone: callerNumber, // ✅ Use real phone number
//         });

//         console.log(`✅ Booked: ${merged.name} - ${merged.service} on ${iso.startISO}`);
//       } catch (e) {
//         console.error("Calendar error:", e);
//         res.type("text/xml").send(
//           voiceResponse({
//             sayText: "I'm having trouble with the booking system. Please call back in a moment.",
//             gatherAction: "/webhook/voice/continue",
//             gatherPrompt: "",
//           })
//         );
//         return;
//       }
//     }

//     bookedCall.add(callSid);
//     addCallMemory(callSid, `AI: Perfect! Your appointment is booked.`);

//     res.type("text/xml").send(
//       voiceResponse({
//         sayText: `Perfect! Your ${merged.service} appointment is booked for ${merged.dayText} at ${merged.timeText}. You'll receive a text confirmation shortly. Is there anything else I can help with?`,
//         gatherAction: "/webhook/voice/continue",
//         gatherPrompt: "",
//       })
//     );
//     return;
//   }

//   // Handle other intents (FAQ, etc.)
//   addCallMemory(callSid, `AI: ${ai.reply}`);
  
//   res.type("text/xml").send(
//     voiceResponse({
//       sayText: ai.reply || "I'm here to help. What else can I do for you?",
//       gatherAction: "/webhook/voice/continue",
//       gatherPrompt: "",
//     })
//   );
// });

// /* ================================
//    HELPER: Build context for AI
// ================================ */
// function buildContextPrompt(slots, currentSpeech) {
//   // ✅ Tell the AI what we already have so it doesn't ask again
//   let context = currentSpeech;
  
//   const collected = [];
//   if (slots.name) collected.push(`name: ${slots.name}`);
//   if (slots.service) collected.push(`service: ${slots.service}`);
//   if (slots.dayText) collected.push(`day: ${slots.dayText}`);
//   if (slots.timeText) collected.push(`time: ${slots.timeText}`);
  
//   if (collected.length > 0) {
//     context = `[Already collected: ${collected.join(", ")}]\nCustomer just said: ${currentSpeech}`;
//   }
  
//   return context;
// }

// export default router;

import express from "express";
import { twimlMessage } from "./twilio.js";


console.log("🔥 routes.js loaded");

const router = express.Router();

/* ================================
   TEST ROUTE (DO NOT REMOVE)
================================ */
router.get("/test-route", (_req, res) => {
  res.json({ ok: true });
});

/* ================================
   PLACEHOLDER ROUTES
================================ */

// SMS webhook placeholder
router.post("/webhook/sms", (req, res) => {
  res.type("text/xml").send(
    twimlMessage("NightDesk SMS webhook working.")
  );
});


// Voice webhook placeholder
router.post("/webhook/voice", (_req, res) => {
  res.send("Voice placeholder");
});

export default router;
