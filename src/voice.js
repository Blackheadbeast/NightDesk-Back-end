import twilio from "twilio";

export function voiceResponse({ sayText, gatherAction, gatherPrompt }) {
  const BASE_URL = process.env.BASE_URL;

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const vr = new VoiceResponse();

  if (sayText) vr.say({ voice: "alice" }, sayText);

  const actionUrl = gatherAction?.startsWith("http")
    ? gatherAction
    : `${BASE_URL}${gatherAction}`;

  const gather = vr.gather({
    input: "speech",
    action: actionUrl,
    method: "POST",
    speechTimeout: "auto",
    language: "en-US",
  });

  if (gatherPrompt) {
    gather.say({ voice: "alice" }, gatherPrompt);
  }

  // ✅ IMPORTANT: If nothing is captured, send them back to the main voice entry
  vr.redirect({ method: "POST" }, `${BASE_URL}/webhook/voice`);

  return vr.toString();
}

export function voiceHangup(text) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const vr = new VoiceResponse();
  if (text) vr.say({ voice: "alice" }, text);
  vr.hangup();
  return vr.toString();
}
