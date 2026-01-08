// import twilio from "twilio";

// export function voiceResponse({ sayText, gatherAction, gatherPrompt }) {
//   const BASE_URL = process.env.BASE_URL;
//   const VoiceResponse = twilio.twiml.VoiceResponse;
//   const vr = new VoiceResponse();

//   if (sayText) {
//     // Try Google Neural2 voice first
//     vr.say({
//       voice: "Google.en-US-Neural2-F",
//       language: "en-US"
//     }, sayText);
//   }

//   const actionUrl = gatherAction?.startsWith("http")
//     ? gatherAction
//     : `${BASE_URL}${gatherAction}`;

//   const gather = vr.gather({
//     input: "speech",
//     action: actionUrl,
//     method: "POST",
//     speechTimeout: "auto",
//     language: "en-US",
//     timeout: 5,
//     speechModel: "phone_call",
//   });

//   if (gatherPrompt) {
//     gather.say({
//       voice: "Google.en-US-Neural2-F",
//       language: "en-US"
//     }, gatherPrompt);
//   }

//   return vr.toString();
// }

// export function voiceHangup(text) {
//   const VoiceResponse = twilio.twiml.VoiceResponse;
//   const vr = new VoiceResponse();
  
//   if (text) {
//     vr.say({
//       voice: "Google.en-US-Neural2-F",
//       language: "en-US"
//     }, text);
//   }
  
//   vr.hangup();
//   return vr.toString();
// }