// import express from "express";
// import { twimlMessage } from "./twilio.js";
// import { voiceResponse, voiceHangup } from "./voice.js";
// import { receptionistReply, receptionistVoiceReply } from "./ai.js";
// import { getMemory, addToMemory } from "./store.js";
// import {
//   getCallMemory,
//   addCallMemory,
//   getBookingState,
//   updateBookingState,
//   clearCall,
// } from "./callStore.js";
// import { mergeSlots, clearSlots } from "./slotStore.js";
// import { buildBookingISO } from "./timeParser.js";
// import calendarService from "./calendar.js";

// // ✅ OAuth helpers (personal Google Calendar demo)
// import { google } from "googleapis";
// import fs from "fs";
// import path from "path";

// console.log("🔥 routes.js loaded");

// const router = express.Router();

// const TOKEN_PATH = path.join(process.cwd(), "google_tokens.json");

// /* ================================
//    GOOGLE OAUTH (DEMO: PERSONAL CAL)
//    Visit /api/connect/google once
// ================================ */
// router.get("/connect/google", (_req, res) => {
//   const oAuth2Client = new google.auth.OAuth2(
//     process.env.GOOGLE_CLIENT_ID,
//     process.env.GOOGLE_CLIENT_SECRET,
//     process.env.GOOGLE_REDIRECT_URI
//   );

//   const url = oAuth2Client.generateAuthUrl({
//     access_type: "offline",
//     prompt: "consent",
//     scope: ["https://www.googleapis.com/auth/calendar"],
//   });

//   res.redirect(url);
// });

// router.get("/oauth2/callback", async (req, res) => {
//   try {
//     const code = req.query.code;
//     if (!code) return res.status(400).send("Missing code");

//     const oAuth2Client = new google.auth.OAuth2(
//       process.env.GOOGLE_CLIENT_ID,
//       process.env.GOOGLE_CLIENT_SECRET,
//       process.env.GOOGLE_REDIRECT_URI
//     );

//     const { tokens } = await oAuth2Client.getToken(code);
//     fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

//     // Make sure calendarService picks up tokens on next call
//     calendarService.reset?.();

//     res.send("✅ Google Calendar connected. You can close this tab.");
//   } catch (e) {
//     console.error("OAuth callback error:", e);
//     res.status(500).send("OAuth error. Check logs.");
//   }
// });

// /* ================================
//    RETELL (OPTIONAL) - SIMPLE API
// ================================ */
// router.post("/retell/availability", async (req, res) => {
//   try {
//     const { startISO, endISO } = req.body;
//     if (!startISO || !endISO) {
//       return res.status(400).json({ error: "Missing startISO/endISO" });
//     }
//     const available = await calendarService.isSlotAvailable(
//       new Date(startISO),
//       new Date(endISO)
//     );
//     res.json({ available });
//   } catch (e) {
//     console.error("retell/availability error:", e);
//     res.status(500).json({ error: "availability_failed" });
//   }
// });

// router.post("/retell/book", async (req, res) => {
//   try {
//     const { startISO, endISO, name, phone, email, notes } = req.body;
//     if (!startISO || !endISO || !name || !phone) {
//       return res
//         .status(400)
//         .json({ error: "Missing startISO/endISO/name/phone" });
//     }

//     const result = await calendarService.bookAppointment(
//       new Date(startISO),
//       new Date(endISO),
//       { name, phone, email: email || "", notes: notes || "" }
//     );

//     res.json(result);
//   } catch (e) {
//     console.error("retell/book error:", e);
//     res.status(500).json({ error: "book_failed" });
//   }
// });

// /* ================================
//    TEST ROUTE (KEEP FOREVER)
// ================================ */
// router.get("/test-route", (_req, res) => {
//   res.json({ ok: true });
// });

// /* ================================
//    HEALTH (OPTIONAL)
// ================================ */
// router.get("/health", (_req, res) => {
//   res.json({ status: "ok" });
// });

// /* ================================
//    SMS WEBHOOK
// ================================ */
// router.post("/webhook/sms", async (req, res) => {
//   try {
//     const from = req.body.From; // phone number = session key
//     const body = (req.body.Body || "").trim();

//     const memory = getMemory(from);
//     addToMemory(from, `Customer: ${body}`);

//     const ai = await receptionistReply({
//       businessProfile: {
//         businessName: "NightDesk Demo",
//         hours: "Mon–Sat 10am–7pm",
//         services: ["Haircut", "Beard Trim", "Haircut & Beard"],
//       },
//       customerMessage: body,
//       memory,
//     });

//     // 🔑 merge extracted booking data
//     const merged = mergeSlots(from, ai.booking || {});

//     let reply = ai.reply;

//     // Ask ONE missing thing only
//     if (ai.intent === "book") {
//       if (!merged.name) reply = "Great! What's your name?";
//       else if (!merged.service) reply = "Which service would you like?";
//       else if (!merged.dayText) reply = "What day works best?";
//       else if (!merged.timeText) reply = `What time on ${merged.dayText}?`;
//       else {
//         reply = `Thanks ${merged.name}! You're booking a ${merged.service} on ${merged.dayText} at ${merged.timeText}. Reply YES to confirm.`;
//       }
//     }

//     // Final confirmation - CREATE CALENDAR EVENT
//     if (/^yes$/i.test(body) && merged.dayText && merged.timeText) {
//       try {
//         const isoTimes = buildBookingISO({
//           dayText: merged.dayText,
//           timeText: merged.timeText,
//           durationMins: 30,
//         });

//         if (isoTimes) {
//           const startTime = new Date(isoTimes.startISO);
//           const endTime = new Date(isoTimes.endISO);

//           const bookingResult = await calendarService.bookAppointment(
//             startTime,
//             endTime,
//             {
//               name: merged.name,
//               phone: from,
//               email: "",
//               notes: `Service: ${merged.service}`,
//             }
//           );

//           if (bookingResult.success) {
//             reply = `✅ Booked: ${merged.service} on ${merged.dayText} at ${merged.timeText}.`;
//           } else {
//             // If taken, suggest alternatives (this is what you wanted)
//             if (bookingResult?.alternatives?.sameDay?.length) {
//               const opts = bookingResult.alternatives.sameDay
//                 .slice(0, 3)
//                 .map((x) => x.label)
//                 .join(", ");
//               reply = `Sorry, that time is not available. We do have: ${opts}. Which one works?`;
//             } else if (bookingResult?.alternatives?.nextDays?.length) {
//               const d = bookingResult.alternatives.nextDays[0];
//               const opts = (d.slots || [])
//                 .slice(0, 2)
//                 .map((x) => x.label)
//                 .join(", ");
//               reply = `That day is booked. Next available is ${d.dateLabel}${opts ? `: ${opts}` : ""}. Which works?`;
//             } else {
//               reply = `Sorry, that time is not available. What other time works?`;
//             }
//           }
//         } else {
//           reply = `Got it — what time would you like instead?`;
//         }
//       } catch (calError) {
//         console.error("Calendar creation error:", calError);
//         reply = `Sorry — I'm having trouble booking right now. What time works best and I’ll confirm?`;
//       }

//       clearSlots(from);
//     }

//     addToMemory(from, `AI: ${reply}`);
//     res.type("text/xml").send(twimlMessage(reply));
//   } catch (err) {
//     console.error("SMS error:", err);
//     res.type("text/xml").send(
//       twimlMessage("Sorry, something went wrong. Please try again.")
//     );
//   }
// });

// /* ================================
//    VOICE ENTRY
// ================================ */
// router.post("/webhook/voice", (_req, res) => {
//   res.type("text/xml").send(
//     voiceResponse({
//       sayText:
//         "Hi, thanks for calling NightDesk. I can help book appointments or answer questions. How can I help?",
//       gatherAction: "/api/webhook/voice/continue",
//       gatherPrompt: "",
//     })
//   );
// });

// /* ================================
//    VOICE CONTINUE
// ================================ */
// router.post("/webhook/voice/continue", async (req, res) => {
//   try {
//     const callSid = req.body.CallSid;
//     const speech = (req.body.SpeechResult || "").trim();

//     console.log(`📞 Call ${callSid}: Customer said: "${speech}"`);

//     if (!speech) {
//       res.type("text/xml").send(
//         voiceResponse({
//           sayText: "Sorry, I didn't catch that. Could you say that again?",
//           gatherAction: "/api/webhook/voice/continue",
//           gatherPrompt: "",
//         })
//       );
//       return;
//     }

//     if (/(bye|goodbye|hang up|that's all|no thanks)/i.test(speech)) {
//       res.type("text/xml").send(voiceHangup("Thanks for calling! Have a great day!"));
//       return;
//     }

//     const booking = getBookingState(callSid);
//     const memory = getCallMemory(callSid);

//     const isConfirming = /(yes|yeah|yep|correct|that's right|confirm)/i.test(speech);
//     const isDeclining = /(no|nope|wrong|incorrect)/i.test(speech);

//     // ✅ If confirming and we have all info, BOOK IT
//     if (isConfirming && booking.name && booking.service && booking.dayText && booking.timeText) {
//   console.log(`✅ Confirmed! Booking for ${booking.name}`);

//   try {
//     const isoTimes = buildBookingISO({
//       dayText: booking.dayText,
//       timeText: booking.timeText,
//       durationMins: 30,
//     });

//     if (!isoTimes) {
//       // couldn't parse -> ask again
//       res.type("text/xml").send(
//         voiceResponse({
//           sayText: `Sorry — what time would you like on ${booking.dayText}?`,
//           gatherAction: "/api/webhook/voice/continue",
//           gatherPrompt: "",
//         })
//       );
//       return;
//     }

//     const startTime = new Date(isoTimes.startISO);
//     const endTime = new Date(isoTimes.endISO);

//     const bookingResult = await calendarService.bookAppointment(startTime, endTime, {
//       name: booking.name,
//       phone: req.body.From || "unknown",
//       email: "",
//       notes: `Service: ${booking.service}`,
//     });

//     // ✅ Only confirm + hangup if booking actually succeeded
//     if (bookingResult.success) {
//       clearCall(callSid);
//       res.type("text/xml").send(
//         voiceHangup(
//           `Perfect! Your ${booking.service} is booked for ${booking.dayText} at ${booking.timeText}. Thanks for calling!`
//         )
//       );
//       return;
//     }

//     // ❌ Slot not available -> offer alternatives, keep call alive
//     const alts = bookingResult?.alternatives;

//     let sayText = `Sorry, ${booking.timeText} is not available. `;

//     if (alts?.sameDay?.length) {
//       const opts = alts.sameDay.slice(0, 3).map((x) => x.label).join(", ");
//       sayText += `I can do: ${opts}. Which one works?`;
//     } else if (alts?.nextDays?.length) {
//       const d = alts.nextDays[0];
//       const opts = (d.slots || []).slice(0, 2).map((x) => x.label).join(", ");
//       sayText += `That day is booked. Next available is ${d.dateLabel}${opts ? `: ${opts}` : ""}. Which works?`;
//     } else {
//       sayText += `What other time works for you?`;
//     }

//     res.type("text/xml").send(
//       voiceResponse({
//         sayText,
//         gatherAction: "/api/webhook/voice/continue",
//         gatherPrompt: "",
//       })
//     );
//     return;
//   } catch (error) {
//     console.error("❌ Booking error:", error);
//     res.type("text/xml").send(
//       voiceResponse({
//         sayText: `Sorry — I'm having trouble booking right now. What time works best and I’ll confirm?`,
//         gatherAction: "/api/webhook/voice/continue",
//         gatherPrompt: "",
//       })
//     );
//     return;
//   }
// }


//     // Build context message
//     let contextMessage = speech;

//     const collectedFields = [];
//     if (booking.name) collectedFields.push(`name: ${booking.name}`);
//     if (booking.service) collectedFields.push(`service: ${booking.service}`);
//     if (booking.dayText) collectedFields.push(`day: ${booking.dayText}`);
//     if (booking.timeText) collectedFields.push(`time: ${booking.timeText}`);

//     if (collectedFields.length > 0) {
//       contextMessage = `[Already collected: ${collectedFields.join(", ")}]\nCustomer just said: ${speech}`;
//     }

//     console.log(`🤖 Calling AI with: "${contextMessage}"`);
//     let ai;

//     try {
//       ai = await receptionistVoiceReply({
//         businessProfile: {
//           businessName: "NightDesk Demo",
//           hours: "Mon–Sat 10am–7pm",
//           services: ["Haircut", "Beard Trim", "Haircut & Beard"],
//         },
//         customerMessage: contextMessage,
//         memory,
//       });
//     } catch (aiError) {
//       console.error(`❌ AI call failed:`, aiError);
//       res.type("text/xml").send(
//         voiceHangup("Sorry, I'm having trouble right now. Please try calling back in a moment.")
//       );
//       return;
//     }

//     if (ai.booking) updateBookingState(callSid, ai.booking);

//     const updated = getBookingState(callSid);

//     let reply = ai.reply;

//     if (updated.name && updated.service && updated.dayText && updated.timeText) {
//       reply = `Great! I have you down for a ${updated.service} on ${updated.dayText} at ${updated.timeText}. Is that correct?`;
//     } else {
//       if (!updated.name) reply = "Great! What's your name?";
//       else if (!updated.service)
//         reply = "Perfect! What service would you like: Haircut, Beard Trim, or Haircut & Beard?";
//       else if (!updated.dayText) reply = "What day works best for you?";
//       else if (!updated.timeText) reply = `What time on ${updated.dayText}?`;
//     }

//     addCallMemory(callSid, `AI: ${reply}`);

//     res.type("text/xml").send(
//       voiceResponse({
//         sayText: reply,
//         gatherAction: "/api/webhook/voice/continue",
//         gatherPrompt: "",
//       })
//     );
//   } catch (err) {
//     console.error("❌ Voice webhook error:", err);
//     res.type("text/xml").send(
//       voiceHangup("Sorry, something went wrong. Please call again later.")
//     );
//   }
// });

// export default router;
// /* ================================
//    END OF FILE
// ================================ */