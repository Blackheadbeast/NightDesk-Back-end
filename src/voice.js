import twilio from "twilio";

export function voiceResponse({ sayText, gatherAction, gatherPrompt }) {
  const BASE_URL = process.env.BASE_URL;
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const vr = new VoiceResponse();

  // Use Google's best neural voice - MUCH more natural
  const voiceConfig = {
    voice: "Google.en-US-Neural2-F", // Natural female voice
    // OR use: "Google.en-US-Neural2-J" for male voice
  };

  if (sayText) {
    // Add prosody for faster, more natural speech
    const enhancedText = `<prosody rate="110%">${sayText}</prosody>`;
    vr.say(
      {
        ...voiceConfig,
        // Use SSML for better control
      },
      enhancedText
    );
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
    // Shorter timeout = faster responses
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
    const enhancedText = `<prosody rate="110%">${text}</prosody>`;
    vr.say(voiceConfig, enhancedText);
  }
  
  vr.hangup();
  return vr.toString();
}