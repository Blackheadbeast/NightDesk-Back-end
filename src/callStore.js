// const calls = new Map(); // key = CallSid, value = { lines: [], booking: {}, updatedAt }

// // Auto-expire after 2 hours (more than enough for calls)
// const TTL_MS = 2 * 60 * 60 * 1000;

// function cleanup() {
//   const now = Date.now();
//   for (const [key, value] of calls.entries()) {
//     if (now - value.updatedAt > TTL_MS) {
//       calls.delete(key);
//     }
//   }
// }

// export function getCallMemory(callSid) {
//   cleanup();

//   if (!calls.has(callSid)) {
//     calls.set(callSid, { 
//       lines: [], 
//       booking: { name: null, service: null, dayText: null, timeText: null },
//       updatedAt: Date.now() 
//     });
//   }

//   const call = calls.get(callSid);
//   call.updatedAt = Date.now();
//   return call.lines;
// }

// export function addCallMemory(callSid, line) {
//   const mem = getCallMemory(callSid);
//   mem.push(line);
//   if (mem.length > 30) mem.splice(0, mem.length - 30);
// }

// // ---- NEW: Track booking progress ----
// export function getBookingState(callSid) {
//   if (!calls.has(callSid)) {
//     calls.set(callSid, { 
//       lines: [], 
//       booking: { name: null, service: null, dayText: null, timeText: null },
//       updatedAt: Date.now() 
//     });
//   }
  
//   const call = calls.get(callSid);
//   call.updatedAt = Date.now();
//   return call.booking;
// }

// export function updateBookingState(callSid, updates) {
//   const booking = getBookingState(callSid);
  
//   // Only update fields that have real values
//   if (updates.name && updates.name.trim()) booking.name = updates.name.trim();
//   if (updates.service && updates.service.trim()) booking.service = updates.service.trim();
//   if (updates.dayText && updates.dayText.trim()) booking.dayText = updates.dayText.trim();
//   if (updates.timeText && updates.timeText.trim()) booking.timeText = updates.timeText.trim();
  
//   return booking;
// }

// export function isBookingComplete(callSid) {
//   const booking = getBookingState(callSid);
//   return !!(booking.name && booking.service && booking.dayText && booking.timeText);
// }

// export function clearCall(callSid) {
//   calls.delete(callSid);
// }