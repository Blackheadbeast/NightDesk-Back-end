import OpenAI from "openai";
import { z } from "zod";

let client = null;

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is missing. Check .env loading.");
  if (!client) client = new OpenAI({ apiKey: key });
  return client;
}

// ---- Strict schema for AI output ----
const BookingSchema = z
  .object({
    name: z.string().optional().default(""),
    service: z.string().optional().default(""),
    dayText: z.string().optional().default(""),
    timeText: z.string().optional().default(""),
  })
  .optional()
  .nullable();

const AIResponseSchema = z.object({
  intent: z.enum(["faq", "book", "reschedule", "cancel", "unknown"]).default("unknown"),
  reply: z.string().default("Okay."),
  booking: BookingSchema,
});

// ---- Helpers ----
function safeAIResponse(overrides = {}) {
  return {
    intent: "unknown",
    reply: "Sorry — I'm having trouble right now. Please try again.",
    booking: null,
    ...overrides,
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function withTimeout(promise, ms, timeoutMessage = "OpenAI request timed out") {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);

  try {
    const result = await promise(ac.signal);
    return result;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(timeoutMessage);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function buildSystemPrompt(businessProfile, memory) {
  const tz = process.env.BUSINESS_TIMEZONE || "America/Denver";

  return `
You are an AI receptionist for ${businessProfile.businessName}.

CRITICAL RULES:
1. If you see "[Already collected: ...]" in the customer's message, DO NOT ask for that information again.
2. Only ask for ONE missing piece of information at a time.
3. Be conversational and natural, not robotic.
4. Keep responses SHORT (1-2 sentences max).
5. Extract booking info from the customer's words, even if they don't say it perfectly.

Business info:
- Services: ${businessProfile.services.join(", ")}
- Hours: ${businessProfile.hours}
- Location: ${businessProfile.location}
- Timezone: ${tz}

Booking requirements:
- name (customer's name)
- service (one of: "Haircut", "Beard trim", "Haircut+Beard")
- dayText (examples: "tomorrow", "Monday", "January 4", "next Friday")
- timeText (examples: "2pm", "2:30", "5 PM", "14:00")

IMPORTANT:
- If the message starts with "[Already collected: ...]", those fields are DONE. Do not ask for them again.
- Only populate booking fields with NEW information from the customer's latest message.
- If customer says something like "I want a haircut tomorrow at 3pm", extract ALL of that.

Output format (JSON only, no other text):
{
  "intent": "faq" | "book" | "reschedule" | "cancel" | "unknown",
  "reply": "your response to the customer (keep it short and natural)",
  "booking": {
    "name": "",
    "service": "",
    "dayText": "",
    "timeText": ""
  } | null
}

Examples:

Customer: "I'd like to book a haircut"
Output:
{
  "intent": "book",
  "reply": "Great! What's your name?",
  "booking": { "name": "", "service": "Haircut", "dayText": "", "timeText": "" }
}

Customer: "[Already collected: service: Haircut, name: John]\nCustomer just said: tomorrow at 2pm"
Output:
{
  "intent": "book",
  "reply": "Perfect! I have you down for a haircut tomorrow at 2pm.",
  "booking": { "name": "", "service": "", "dayText": "tomorrow", "timeText": "2pm" }
}

Conversation history:
${(memory || []).join("\n")}
`.trim();
}

async function callModel({
  businessProfile,
  customerMessage,
  memory,
  maxTokens = 140,
  temperature = 0.2,
  timeoutMs = 9000,
}) {
  const openai = getClient();

  const system = buildSystemPrompt(businessProfile, memory);

  const resp = await withTimeout(
    async (signal) => {
      return await openai.chat.completions.create(
        {
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          messages: [
            { role: "system", content: system },
            { role: "user", content: customerMessage || "" },
          ],
          response_format: { type: "json_object" },
          max_tokens: maxTokens,
          temperature,
        },
        { signal }
      );
    },
    timeoutMs
  );

  const content = resp?.choices?.[0]?.message?.content || "";
  const raw = safeJsonParse(content);
  const parsed = AIResponseSchema.safeParse(raw);

  if (!parsed.success) {
    console.log("⚠️ AI parsing failed:", parsed.error);
    return safeAIResponse({
      intent: "unknown",
      reply: "Sorry — I didn't catch that. Can you say that again?",
      booking: null,
    });
  }

  const out = parsed.data;

  if (out.intent !== "book") out.booking = null;
  if (!out.reply || !out.reply.trim()) out.reply = "Okay.";

  return out;
}

// ---- Public API ----
export async function receptionistReply({ businessProfile, customerMessage, memory }) {
  try {
    return await callModel({
      businessProfile,
      customerMessage,
      memory,
      maxTokens: 160,
      temperature: 0.2,
      timeoutMs: 9000,
    });
  } catch (e) {
    console.log("❌ AI error:", e?.message || e);
    return safeAIResponse({
      intent: "unknown",
      reply: "Sorry — I'm having trouble right now. Please try again.",
      booking: null,
    });
  }
}

export async function receptionistVoiceReply({ businessProfile, customerMessage, memory }) {
  try {
    return await callModel({
      businessProfile,
      customerMessage,
      memory,
      maxTokens: 120,
      temperature: 0.15,
      timeoutMs: 8500,
    });
  } catch (e) {
    console.log("❌ AI voice error:", e?.message || e);
    return safeAIResponse({
      intent: "unknown",
      reply: "Sorry — I'm having trouble right now. Please try again.",
      booking: null,
    });
  }
}