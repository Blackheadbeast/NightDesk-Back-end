import twilio from "twilio";

export function voiceResponse({ sayText, gatherAction, gatherPrompt }) {
  const BASE_URL = process.env.BASE_URL;
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const vr = new VoiceResponse();

  if (sayText) {
    // Use Polly.Salli - more natural than alice
    vr.say({
      voice: "Polly.Salli",
      language: "en-US"
    }, sayText);
  }

  const actionUrl = gatherAction?.startsWith("http")
    ? gatherAction
    : `${BASE_URL}${gatherAction}`;

  const gather = vr.gather({
    input: "speech",
    action: actionUrl,
    method: "POST",
    speechTimeout: "auto",
    language: "en-US",
    timeout: 5,  // Increased from 2 to 5 seconds
    speechModel: "numbers_and_commands", // Better for booking info
  });

  if (gatherPrompt) {
    gather.say({
      voice: "Polly.Salli",
      language: "en-US"
    }, gatherPrompt);
  }

  return vr.toString();
}

export function voiceHangup(text) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const vr = new VoiceResponse();
  
  if (text) {
    vr.say({
      voice: "Polly.Salli",
      language: "en-US"
    }, text);
  }
  
  vr.hangup();
  return vr.toString();
}