import twilio from "twilio";

export function voiceResponse({ sayText, gatherAction, gatherPrompt }) {
  const BASE_URL = process.env.BASE_URL;
  if (!BASE_URL) {
    throw new Error("BASE_URL is not set");
  }

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const vr = new VoiceResponse();

  // Speak the AI response (once)
  if (sayText) {
    vr.say({ voice: "alice" }, sayText);
  }

  const actionUrl = gatherAction.startsWith("http")
    ? gatherAction
    : `${BASE_URL}${gatherAction}`;

  // Gather BOTH speech + keypad (important for trial accounts)
  const gather = vr.gather({
    input: "speech dtmf",
    numDigits: 1,
    action: actionUrl,
    method: "POST",
    speechTimeout: "auto",
    language: "en-US",
  });

  // Only speak a prompt if provided (prevents repetition)
  if (gatherPrompt) {
    gather.say({ voice: "alice" }, gatherPrompt);
  }

  // If nothing is captured, loop back safely
  vr.redirect({ method: "POST" }, actionUrl);

  return vr.toString();
}

export function voiceHangup(text) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const vr = new VoiceResponse();

  if (text) {
    vr.say({ voice: "alice" }, text);
  }

  vr.hangup();
  return vr.toString();
}
