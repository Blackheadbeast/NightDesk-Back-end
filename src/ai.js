import twilio from "twilio";

export function voiceResponse({ sayText, gatherAction, gatherPrompt }) {
  const BASE_URL = process.env.BASE_URL;
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const vr = new VoiceResponse();

  // Use Google's Neural2 voice - more natural
  const voiceConfig = {
    voice: "Google.en-US-Neural2-F",
  };

  if (sayText) {
    vr.say(voiceConfig, sayText);
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
    speechModel: "phone_call",
    enhanced: true,
    timeout: 3,
  });

  if (gatherPrompt) {
    gather.say(voiceConfig, gatherPrompt);
  }

  return vr.toString();
}

export function voiceHangup(text) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const vr = new VoiceResponse();
  
  const voiceConfig = {
    voice: "Google.en-US-Neural2-F",
  };
  
  if (text) {
    vr.say(voiceConfig, text);
  }
  
  vr.hangup();
  return vr.toString();
}