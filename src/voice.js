import twilio from "twilio";

/**
 * ✅ Better voice options:
 * 
 * Option 1: Use Polly voices (more natural than alice)
 * - Polly.Joanna (US female, conversational)
 * - Polly.Matthew (US male)
 * - Polly.Amy (UK female)
 * 
 * Option 2: Use Google voices (even better)
 * - Google.en-US-Neural2-F (female, very natural)
 * - Google.en-US-Neural2-A (male, very natural)
 * 
 * Recommendation: Use Google Neural2 voices for best quality
 */

export function voiceResponse({ sayText, gatherAction, gatherPrompt }) {
  const BASE_URL = process.env.BASE_URL;

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const vr = new VoiceResponse();

  // Use Google's Neural2 voice for much more natural sound
  const voiceConfig = {
    voice: "Google.en-US-Neural2-F", // Natural female voice
    // Alternatives:
    // voice: "Google.en-US-Neural2-A"  // Natural male voice
    // voice: "Polly.Joanna"            // Good fallback if Google not enabled
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
    // Add hints for better speech recognition
    speechModel: "phone_call", // Optimized for phone calls
    enhanced: true, // Use enhanced speech recognition
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
  
  if (text) vr.say(voiceConfig, text);
  vr.hangup();
  return vr.toString();
}