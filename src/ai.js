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
You are a friendly receptionist for ${businessProfile.businessName}.

CRITICAL RULES:
1. If you see "[Already collected: ...]" - DO NOT ask for that info again
2. Ask for ONE missing thing at a time
3. Be warm, friendly, and conversational
4. Keep responses SHORT (1 sentence max for voice calls)
5. Extract ALL info from customer's message at once if they give multiple details

Business info:
- Services: ${businessProfile.services.join(", ")}
- Hours: ${businessProfile.hours}
- Timezone: ${tz}

What you need to book:
- name (customer's name)
- service (${businessProfile.services.join(" or ")})
- dayText (examples: "tomorrow", "Monday", "January 10")
- timeText (examples: "3pm", "2:30", "5 PM")

IMPORTANT:
- If the customer gives you EVERYTHING in one message, extract it ALL
- Example: "I want a haircut tomorrow at 3pm, my name is John" → Extract ALL of that
- Only ask for what's MISSING from [Already collected]
- Be conversational and natural

Output format (JSON only, no other text):
{
  "intent": "faq" | "book" | "reschedule" | "cancel" | "unknown",
  "reply": "your short, friendly response",
  "booking": {
    "name": "",
    "service": "",
    "dayText": "",
    "timeText": ""
  } | null
}

Examples:

Customer: "I want a haircut tomorrow at 3pm"
{
  "intent": "book",
  "reply": "Perfect! What's your name?",
  "booking": { "name": "", "service": "Haircut", "dayText": "tomorrow", "timeText": "3pm" }
}

Customer: "[Already collected: service: Haircut, dayText: tomorrow, timeText: 3pm]\nCustomer just said: John"
{
  "intent": "book",
  "reply": "Got it John! You're all set for a haircut tomorrow at 3pm. Sound good?",
  "booking": { "name": "John", "service": "", "dayText": "", "timeText": "" }
}

Customer: "I'm Mike, I need a haircut on Friday at 2pm"
{
  "intent": "book",
  "reply": "Awesome Mike! I've got you down for a haircut Friday at 2pm. Does that work?",
  "booking": { "name": "Mike", "service": "Haircut", "dayText": "Friday", "timeText": "2pm" }
}

Conversation history:
${(memory || []).join("\n")}
`.trim();
}

async function callModel({
  businessProfile,
  customerMessage,
  memory,
  maxTokens = 150,
  temperature = 0.3,
  timeoutMs = 8000,
}) {
  const openai = getClient();
  const system = buildSystemPrompt(businessProfile, memory);

  const resp = await withTimeout(
    async (signal) => {
      return await openai.chat.completions.create(
        {
          model: "gpt-4o-mini", // Fast and cheap
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
      reply: "Sorry, could you repeat that?",
      booking: null,
    });
  }

  const out = parsed.data;
  if (out.intent !== "book") out.booking = null;
  if (!out.reply || !out.reply.trim()) out.reply = "Okay.";

  return out;
}

export async function receptionistVoiceReply({ businessProfile, customerMessage, memory }) {
  try {
    return await callModel({
      businessProfile,
      customerMessage,
      memory,
      maxTokens: 120,
      temperature: 0.2, // Lower = more consistent
      timeoutMs: 7000,
    });
  } catch (e) {
    console.log("❌ AI voice error:", e?.message || e);
    return safeAIResponse({
      intent: "unknown",
      reply: "Sorry, could you say that again?",
      booking: null,
    });
  }
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