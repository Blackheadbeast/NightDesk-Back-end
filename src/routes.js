import express from "express";
import { twimlMessage } from "./twilio.js";
import { voiceResponse, voiceHangup } from "./voice.js";
import { receptionistReply, receptionistVoiceReply } from "./ai.js";
import { getMemory, addToMemory } from "./store.js";
import { getCallMemory, addCallMemory, getBookingState, updateBookingState, clearCall } from "./callStore.js";
import { getSlots, mergeSlots, clearSlots } from "./slotStore.js";
import { buildBookingISO } from "./timeParser.js";
import calendarService from "./calendar.js"; // CHANGED: Import the singleton instance

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
          // CHANGED: Use new calendar service
          const startTime = new Date(isoTimes.startISO);
          const endTime = new Date(isoTimes.endISO);
          
          const bookingResult = await calendarService.bookAppointment(
            startTime,
            endTime,
            {
              name: merged.name,
              phone: from,
              email: "",
              notes: `Service: ${merged.service}`,
            }
          );

          if (bookingResult.success) {
            reply = `✅ Your ${merged.service} is booked for ${merged.dayText} at ${merged.timeText}. Check your email for confirmation!`;
          } else {
            reply = `✅ Your ${merged.service} is noted for ${merged.dayText} at ${merged.timeText}. We'll confirm via text shortly.`;
          }
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
   VOICE CONTINUE - FIXED VERSION
================================ */
router.post("/webhook/voice/continue", async (req, res) => {
  try {
    const callSid = req.body.CallSid;
    const speech = (req.body.SpeechResult || "").trim();

    console.log(`📞 Call ${callSid}: Customer said: "${speech}"`);

    // Handle empty speech
    if (!speech) {
      res.type("text/xml").send(
        voiceResponse({
          sayText: "Sorry, I didn't catch that. Could you say that again?",
          gatherAction: "/api/webhook/voice/continue",
          gatherPrompt: "",
        })
      );
      return;
    }

    // Handle goodbye
    if (/(bye|goodbye|hang up|that's all|no thanks)/i.test(speech)) {
      res.type("text/xml").send(
        voiceHangup("Thanks for calling! Have a great day!")
      );
      return;
    }

    // Get booking state
    const booking = getBookingState(callSid);
    const memory = getCallMemory(callSid);
    
    // Check if this is a confirmation (YES/NO)
    const isConfirming = /(yes|yeah|yep|correct|that's right|confirm)/i.test(speech);
    const isDeclining = /(no|nope|wrong|incorrect)/i.test(speech);

    // If they're confirming and we have all info, BOOK IT
    if (isConfirming && booking.name && booking.service && booking.dayText && booking.timeText) {
      console.log(`✅ Confirmed! Booking for ${booking.name}`);
      
      try {
        // Build the booking time
        const isoTimes = buildBookingISO({
          dayText: booking.dayText,
          timeText: booking.timeText,
          durationMins: 30,
        });

        if (isoTimes) {
          // CHANGED: Use new calendar service
          const startTime = new Date(isoTimes.startISO);
          const endTime = new Date(isoTimes.endISO);
          
          const bookingResult = await calendarService.bookAppointment(
            startTime,
            endTime,
            {
              name: booking.name,
              phone: req.body.From || "unknown",
              email: "",
              notes: `Service: ${booking.service}`,
            }
          );
          
          if (bookingResult.success) {
            console.log(`📅 Calendar event created for ${booking.name}`);
          } else {
            console.warn(`⚠️ Calendar booking failed: ${bookingResult.message}`);
          }
        }

        // Clear the booking state
        clearCall(callSid);

        // Send confirmation and HANG UP
        res.type("text/xml").send(
          voiceHangup(
            `Perfect! Your ${booking.service} is booked for ${booking.dayText} at ${booking.timeText}. You'll get a text confirmation right now. Thanks for calling!`
          )
        );
        return;
      } catch (error) {
        console.error("❌ Booking error:", error);
        res.type("text/xml").send(
          voiceHangup(
            `Your ${booking.service} is booked for ${booking.dayText} at ${booking.timeText}. Thanks for calling!`
          )
        );
        return;
      }
    }

    // If they're declining, start over
    if (isDeclining && booking.name) {
      console.log("❌ Customer said no, restarting...");
      clearCall(callSid);
      res.type("text/xml").send(
        voiceResponse({
          sayText: "No problem! Let's start over. What service would you like to book?",
          gatherAction: "/api/webhook/voice/continue",
          gatherPrompt: "",
        })
      );
      return;
    }

    // Add to memory
    addCallMemory(callSid, `Customer: ${speech}`);

    // Build the context message for AI
    let contextMessage = speech;
    
    // Tell AI what we already have
    const collectedFields = [];
    if (booking.name) collectedFields.push(`name: ${booking.name}`);
    if (booking.service) collectedFields.push(`service: ${booking.service}`);
    if (booking.dayText) collectedFields.push(`day: ${booking.dayText}`);
    if (booking.timeText) collectedFields.push(`time: ${booking.timeText}`);
    
    if (collectedFields.length > 0) {
      contextMessage = `[Already collected: ${collectedFields.join(', ')}]\nCustomer just said: ${speech}`;
    }

    // Call AI with better error handling
    console.log(`🤖 Calling AI with: "${contextMessage}"`);
    let ai;
    try {
      ai = await receptionistVoiceReply({
        businessProfile: {
          businessName: "NightDesk Demo",
          hours: "Mon–Sat 10am–7pm",
          services: ["Haircut", "Beard Trim", "Haircut & Beard"],
        },
        customerMessage: contextMessage,
        memory,
      });
      console.log(`✅ AI responded:`, ai);
    } catch (aiError) {
      console.error(`❌ AI call failed:`, aiError);
      res.type("text/xml").send(
        voiceHangup("Sorry, I'm having trouble right now. Please try calling back in a moment.")
      );
      return;
    }

    console.log(`🤖 AI response: ${ai.reply}`);
    console.log(`🤖 AI booking data:`, ai.booking);

    // Update booking state with NEW info only
    if (ai.booking) {
      updateBookingState(callSid, ai.booking);
    }

    // Get updated booking state
    const updated = getBookingState(callSid);

    // Determine what to say
    let reply = ai.reply;

    // If we have everything, ask for confirmation
    if (updated.name && updated.service && updated.dayText && updated.timeText) {
      reply = `Great! I have you down for a ${updated.service} on ${updated.dayText} at ${updated.timeText}. Is that correct?`;
    }

    addCallMemory(callSid, `AI: ${reply}`);

    res.type("text/xml").send(
      voiceResponse({
        sayText: reply,
        gatherAction: "/api/webhook/voice/continue",
        gatherPrompt: "",
      })
    );
  } catch (err) {
    console.error("❌ Voice webhook error:", err);
    res.type("text/xml").send(
      voiceHangup("Sorry, something went wrong. Please call again later.")
    );
  }
});

export default router;