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

  // If they say nothing, Twilio will still hit your actionUrl with empty SpeechResult.
  // Your /webhook/voice/continue already handles empty speech and reprompts.
  if (gatherPrompt) gather.say({ voice: "alice" }, gatherPrompt);

  return vr.toString();
}

export function voiceHangup(text) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const vr = new VoiceResponse();
  if (text) vr.say({ voice: "alice" }, text);
  vr.hangup();
  return vr.toString();
}
