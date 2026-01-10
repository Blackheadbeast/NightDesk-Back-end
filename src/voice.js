// import twilio from "twilio";

// export function voiceResponse({ sayText, gatherAction, gatherPrompt }) {
//   const BASE_URL = process.env.BASE_URL;
//   const VoiceResponse = twilio.twiml.VoiceResponse;
//   const vr = new VoiceResponse();

//   if (sayText) {
//     // Use Polly.Joanna - MUCH better than alice
//     vr.say({
//       voice: "Polly.Joanna",
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
//     speechModel: "phone_call", // Better for natural conversation
//   });

//   if (gatherPrompt) {
//     gather.say({
//       voice: "Polly.Joanna",
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
//       voice: "Polly.Joanna",
//       language: "en-US"
//     }, text);
//   }
  
//   vr.hangup();
//   return vr.toString();
// }