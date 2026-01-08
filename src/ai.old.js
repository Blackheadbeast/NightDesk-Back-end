// import OpenAI from "openai";
// import { z } from "zod";
// import calendarService from "./calendar.js";
// import { parseDateTime } from "./timeParser.js";
// import config from "./config.js";

// let client = null;

// function getClient() {
//   const key = process.env.OPENAI_API_KEY;
//   if (!key) throw new Error("OPENAI_API_KEY is missing. Check .env loading.");
//   if (!client) client = new OpenAI({ apiKey: key });
//   return client;
// }

// // ---- Strict schema for AI output ----
// const BookingSchema = z
//   .object({
//     name: z.string().optional().default(""),
//     service: z.string().optional().default(""),
//     dayText: z.string().optional().default(""),
//     timeText: z.string().optional().default(""),
//     phone: z.string().optional().default(""),
//     email: z.string().optional().default(""),
//   })
//   .optional()
//   .nullable();

// const AIResponseSchema = z.object({
//   intent: z.enum(["faq", "book", "reschedule", "cancel", "unknown"]).default("unknown"),
//   reply: z.string().default("Okay."),
//   booking: BookingSchema,
// });

// // ---- Helpers ----
// function safeAIResponse(overrides = {}) {
//   return {
//     intent: "unknown",
//     reply: "Sorry — I'm having trouble right now. Please try again.",
//     booking: null,
//     ...overrides,
//   };
// }

// function safeJsonParse(text) {
//   try {
//     return JSON.parse(text);
//   } catch {
//     const start = text.indexOf("{");
//     const end = text.lastIndexOf("}");
//     if (start !== -1 && end !== -1 && end > start) {
//       try {
//         return JSON.parse(text.slice(start, end + 1));
//       } catch {
//         return null;
//       }
//     }
//     return null;
//   }
// }

// async function withTimeout(promise, ms, timeoutMessage = "OpenAI request timed out") {
//   const ac = new AbortController();
//   const t = setTimeout(() => ac.abort(), ms);

//   try {
//     const result = await promise(ac.signal);
//     return result;
//   } catch (e) {
//     if (e?.name === "AbortError") throw new Error(timeoutMessage);
//     throw e;
//   } finally {
//     clearTimeout(t);
//   }
// }

// function buildSystemPrompt(businessProfile, memory) {
//   const tz = process.env.BUSINESS_TIMEZONE || "America/Denver";

//   return `
// You are a friendly receptionist for ${businessProfile.businessName}.

// CRITICAL RULES:
// 1. If you see "[Already collected: ...]" - DO NOT ask for that info again
// 2. Ask for ONE missing thing at a time
// 3. Be warm, friendly, and conversational
// 4. Keep responses SHORT (1 sentence max for voice calls)
// 5. Extract ALL info from customer's message at once if they give multiple details
// 6. ALWAYS return a booking object when intent is "book" - NEVER return null
// 7. Only fill in the NEW fields the customer just provided - leave other fields empty

// Business info:
// - Services: ${businessProfile.services.join(", ")}
// - Hours: ${businessProfile.hours}
// - Timezone: ${tz}

// What you need to book:
// - name (customer's name)
// - service (${businessProfile.services.join(" or ")})
// - dayText (examples: "tomorrow", "Monday", "January 10")
// - timeText (examples: "3pm", "2:30", "5 PM")
// - phone (optional, may already be captured from call)
// - email (optional)

// IMPORTANT:
// - If the customer gives you EVERYTHING in one message, extract it ALL
// - Example: "I want a haircut tomorrow at 3pm, my name is John" → Extract ALL of that
// - Only ask for what's MISSING from [Already collected]
// - Be conversational and natural
// - Only mention checking availability AFTER you have collected name, service, day, and time
// - Until then, just acknowledge what they said and ask for the next missing piece
// - ALWAYS return booking object even if only filling ONE field - DO NOT return null

// Output format (JSON only, no other text):
// {
//   "intent": "faq" | "book" | "reschedule" | "cancel" | "unknown",
//   "reply": "your short, friendly response",
//   "booking": {
//     "name": "",
//     "service": "",
//     "dayText": "",
//     "timeText": "",
//     "phone": "",
//     "email": ""
//   }
// }

// CRITICAL: Never return "booking": null when intent is "book". Always return the booking object with at least the new field filled.

// Examples:

// Customer: "I want a haircut tomorrow at 3pm"
// {
//   "intent": "book",
//   "reply": "Perfect! What's your name?",
//   "booking": { "name": "", "service": "Haircut", "dayText": "tomorrow", "timeText": "3pm", "phone": "", "email": "" }
// }

// Customer: "[Already collected: service: Haircut, dayText: tomorrow, timeText: 3pm]\\nCustomer just said: John"
// {
//   "intent": "book",
//   "reply": "Great! Let me check if tomorrow at 3pm is available...",
//   "booking": { "name": "John", "service": "", "dayText": "", "timeText": "", "phone": "", "email": "" }
// }

// Customer: "[Already collected: name: John Smith, day: tomorrow, time: 2:00 p.m.]\\nCustomer just said: Haircut"
// {
//   "intent": "book",
//   "reply": "Perfect! Let me check if tomorrow at 2:00 PM is available...",
//   "booking": { "name": "", "service": "Haircut", "dayText": "", "timeText": "", "phone": "", "email": "" }
// }

// Customer: "I'm Mike, I need a haircut on Friday at 2pm"
// {
//   "intent": "book",
//   "reply": "Awesome! Let me check if Friday at 2pm works...",
//   "booking": { "name": "Mike", "service": "Haircut", "dayText": "Friday", "timeText": "2pm", "phone": "", "email": "" }
// }

// Conversation history:
// ${(memory || []).join("\n")}
// `.trim();
// }

// async function callModel({
//   businessProfile,
//   customerMessage,
//   memory,
//   maxTokens = 150,
//   temperature = 0.3,
//   timeoutMs = 8000,
// }) {
//   const openai = getClient();
//   const system = buildSystemPrompt(businessProfile, memory);

//   const resp = await withTimeout(
//     async (signal) => {
//       return await openai.chat.completions.create(
//         {
//           model: "gpt-4o-mini",
//           messages: [
//             { role: "system", content: system },
//             { role: "user", content: customerMessage || "" },
//           ],
//           response_format: { type: "json_object" },
//           max_tokens: maxTokens,
//           temperature,
//         },
//         { signal }
//       );
//     },
//     timeoutMs
//   );

//   const content = resp?.choices?.[0]?.message?.content || "";
//   const raw = safeJsonParse(content);
  
//   // Add debug logging
//   console.log("🔍 Raw AI response:", content);
  
//   const parsed = AIResponseSchema.safeParse(raw);

//   if (!parsed.success) {
//     console.log("⚠️ AI parsing failed:", parsed.error);
//     console.log("⚠️ Raw content was:", content);
//     return safeAIResponse({
//       intent: "unknown",
//       reply: "Sorry, could you repeat that?",
//       booking: null,
//     });
//   }

//   const out = parsed.data;
  
//   // CHANGED: Keep booking object for "book" intent, even if empty
//   if (out.intent !== "book") {
//     out.booking = null;
//   } else if (!out.booking) {
//     // If booking is null but intent is book, create empty booking object
//     out.booking = {
//       name: "",
//       service: "",
//       dayText: "",
//       timeText: "",
//       phone: "",
//       email: ""
//     };
//   }
  
//   if (!out.reply || !out.reply.trim()) out.reply = "Okay.";

//   return out;
// }

// /**
//  * Check if we have all required booking information
//  */
// function hasCompleteBookingInfo(booking) {
//   return (
//     booking &&
//     booking.name &&
//     booking.service &&
//     booking.dayText &&
//     booking.timeText
//   );
// }

// /**
//  * Handle appointment booking with calendar integration
//  * @param {Object} completeBooking - Complete booking info with name, service, dayText, timeText
//  * @param {string} callerPhone - Phone number from call
//  * @returns {Promise<Object>} - Booking result with voice response
//  */
// export async function handleAppointmentBooking(completeBooking, callerPhone = "") {
//   try {
//     // Parse the requested date and time
//     const startTime = parseDateTime(completeBooking.dayText, completeBooking.timeText);
//     const durationMinutes = config.appointment.defaultDuration;
//     const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

//     // Prepare caller info
//     const callerInfo = {
//       name: completeBooking.name,
//       phone: completeBooking.phone || callerPhone,
//       email: completeBooking.email || "",
//       notes: `Service: ${completeBooking.service}`,
//     };

//     // Attempt to book the appointment
//     const bookingResult = await calendarService.bookAppointment(
//       startTime,
//       endTime,
//       callerInfo
//     );

//     if (bookingResult.success) {
//       // SUCCESS - Slot was available and booked
//       const formattedDate = calendarService.formatDateForVoice(startTime);
//       const formattedTime = calendarService.formatTimeForVoice(startTime);

//       return {
//         status: "BOOKED",
//         eventId: bookingResult.eventId,
//         intent: "book",
//         reply: `Perfect! I've checked the calendar and ${formattedDate} at ${formattedTime} is available. Your appointment is confirmed! You'll receive a confirmation email shortly.`,
//       };
//     }

//     // UNAVAILABLE - Handle different scenarios
//     if (bookingResult.reason === "SLOT_TAKEN" || bookingResult.reason === "RACE_CONDITION") {
//       // Try to find alternatives on the same day
//       const sameDaySlots = await calendarService.findAvailableSlots(
//         startTime,
//         durationMinutes,
//         3
//       );

//       if (sameDaySlots.length > 0) {
//         // Found alternatives same day
//         const alternatives = sameDaySlots
//           .map((slot) => calendarService.formatTimeForVoice(slot.start))
//           .join(", or ");

//         const formattedDate = calendarService.formatDateForVoice(startTime);
//         const formattedTime = calendarService.formatTimeForVoice(startTime);

//         return {
//           status: "UNAVAILABLE_SAME_DAY",
//           alternatives: sameDaySlots,
//           intent: "book",
//           reply: `I checked and ${formattedTime} on ${formattedDate} is already booked. However, I have ${alternatives} available that same day. Would any of those work?`,
//         };
//       }

//       // Entire day is booked - find next available days
//       const nextDay = new Date(startTime);
//       nextDay.setDate(nextDay.getDate() + 1);

//       const nextAvailableDays = await calendarService.findNextAvailableDays(
//         nextDay,
//         durationMinutes,
//         3,
//         2
//       );

//       if (nextAvailableDays.length > 0) {
//         const dayOptions = nextAvailableDays
//           .map((day) => {
//             const times = day.slots
//               .map((slot) => calendarService.formatTimeForVoice(slot.start))
//               .join(" or ");
//             return `${calendarService.formatDateForVoice(day.date)} at ${times}`;
//           })
//           .join(", ");

//         const formattedDate = calendarService.formatDateForVoice(startTime);

//         return {
//           status: "DAY_FULL",
//           alternatives: nextAvailableDays,
//           intent: "book",
//           reply: `I checked and ${formattedDate} is completely booked. The next available times are: ${dayOptions}. Would any of these work?`,
//         };
//       }

//       // No availability in next 2 weeks
//       return {
//         status: "NO_AVAILABILITY",
//         intent: "book",
//         reply: `I checked and we're completely booked for the next two weeks. Would you like me to take your information and have someone call you back?`,
//       };
//     }

//     // Unexpected error
//     return {
//       status: "ERROR",
//       intent: "unknown",
//       reply: `I'm having trouble accessing the calendar right now. Let me take your information and have someone call you back to confirm.`,
//     };
//   } catch (error) {
//     console.error("❌ Booking error:", error);
//     return {
//       status: "ERROR",
//       intent: "unknown",
//       reply: `I'm having trouble accessing the calendar right now. Let me take your information and have someone call you back to confirm.`,
//     };
//   }
// }

// // ---- Public API ----
// export async function receptionistReply({ businessProfile, customerMessage, memory, accumulatedBooking = null, callerPhone = "" }) {
//   try {
//     const aiResponse = await callModel({
//       businessProfile,
//       customerMessage,
//       memory,
//       maxTokens: 160,
//       temperature: 0.2,
//       timeoutMs: 9000,
//     });

//     // Check if we have complete booking info after this response
//     if (aiResponse.intent === "book" && aiResponse.booking) {
//       // Merge with accumulated booking data
//       const completeBooking = {
//         ...accumulatedBooking,
//         ...Object.fromEntries(
//           Object.entries(aiResponse.booking).filter(([_, v]) => v && v.trim())
//         ),
//       };

//       // If we have all required info, attempt to book
//       if (hasCompleteBookingInfo(completeBooking)) {
//         const bookingResult = await handleAppointmentBooking(completeBooking, callerPhone);
        
//         // Return the booking result with the calendar-aware response
//         return {
//           ...aiResponse,
//           reply: bookingResult.reply,
//           bookingStatus: bookingResult.status,
//           alternatives: bookingResult.alternatives,
//         };
//       }
//     }

//     return aiResponse;
//   } catch (e) {
//     console.log("❌ AI error:", e?.message || e);
//     return safeAIResponse({
//       intent: "unknown",
//       reply: "Sorry — I'm having trouble right now. Please try again.",
//       booking: null,
//     });
//   }
// }

// export async function receptionistVoiceReply({ businessProfile, customerMessage, memory, accumulatedBooking = null, callerPhone = "" }) {
//   try {
//     const aiResponse = await callModel({
//       businessProfile,
//       customerMessage,
//       memory,
//       maxTokens: 80,
//       temperature: 0.1,
//       timeoutMs: 8000,
//     });

//     // Check if we have complete booking info after this response
//     if (aiResponse.intent === "book" && aiResponse.booking) {
//       // Merge with accumulated booking data
//       const completeBooking = {
//         ...accumulatedBooking,
//         ...Object.fromEntries(
//           Object.entries(aiResponse.booking).filter(([_, v]) => v && v.trim())
//         ),
//       };

//       // If we have all required info, attempt to book
//       if (hasCompleteBookingInfo(completeBooking)) {
//         const bookingResult = await handleAppointmentBooking(completeBooking, callerPhone);
        
//         // Return the booking result with the calendar-aware response
//         return {
//           ...aiResponse,
//           reply: bookingResult.reply,
//           bookingStatus: bookingResult.status,
//           alternatives: bookingResult.alternatives,
//         };
//       }
//     }

//     return aiResponse;
//   } catch (e) {
//     console.log("❌ AI voice error:", e?.message || e);
//     return safeAIResponse({
//       intent: "unknown",
//       reply: "Sorry, could you say that again?",
//       booking: null,
//     });
//   }
// }