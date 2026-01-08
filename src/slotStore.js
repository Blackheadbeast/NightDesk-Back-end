// const slotsByCall = new Map(); // callSid -> { name, service, dayText, timeText }

// export function getSlots(callSid) {
//   if (!slotsByCall.has(callSid)) {
//     slotsByCall.set(callSid, { name: "", service: "", dayText: "", timeText: "" });
//   }
//   return slotsByCall.get(callSid);
// }

// export function mergeSlots(callSid, incoming = {}) {
//   const cur = getSlots(callSid);
//   const next = { ...cur };

//   for (const k of ["name", "service", "dayText", "timeText"]) {
//     const v = (incoming?.[k] ?? "").toString().trim();
//     if (v) next[k] = v; // only overwrite if non-empty
//   }

//   slotsByCall.set(callSid, next);
//   return next;
// }

// export function clearSlots(callSid) {
//   slotsByCall.delete(callSid);
// }
