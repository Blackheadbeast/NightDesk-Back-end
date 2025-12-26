import OpenAI from "openai";
import { z } from "zod";

/**
 * ✅ Hardening goals:
 * - OpenAI/API/network errors never crash the call
 * - Invalid / non-JSON model output never crashes the call
 * - Always returns a valid, predictable object shape
 * - Adds a timeout so calls don't hang forever
 */

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
    // We now prefer deterministic parsing on server:
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
    reply: "Sorry — I’m having trouble right now. Please try again.",
    booking: null,
    ...overrides,
  };
}

function safeJsonParse(text) {
  // Model *should* return JSON, but we still guard hard.
  try {
    return JSON.parse(text);
  } catch {
    // Try to salvage if model wrapped JSON in text
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
    // Pass signal if the promise factory supports it (we'll use it below)
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
You are an AI receptionist for a small business.

Goals:
- Be fast, natural, and brief.
- Ask only ONE question at a time when needed.
- Do NOT ramble or repeat yourself.
- Never output anything except JSON.

Important:
- The server will convert date/time into ISO.
- You must provide booking.dayText and booking.timeText (human text) when ready to book.
- If the customer says "tomorrow", interpret it relative to the business timezone (${tz}).

Booking requirements:
- name
- service (one of: "Haircut", "Beard trim", "Haircut+Beard")
- dayText (ex: "tomorrow", "January 4", "12/25")
- timeText (ex: "2pm", "14:30", "5 PM")

If anything is missing, set intent="book" and ask exactly ONE short question to get the missing info.

Output format (JSON only):
{
  "intent": "faq" | "book" | "reschedule" | "cancel" | "unknown",
  "reply": "short sentence to say to the customer",
  "booking": {
    "name": "",
    "service": "",
    "dayText": "",
    "timeText": ""
  } | null
}

Business info:
${JSON.stringify(businessProfile)}

Conversation so far:
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
        { signal } // OpenAI SDK supports AbortController signal in recent versions
      );
    },
    timeoutMs
  );

  const content = resp?.choices?.[0]?.message?.content || "";
  const raw = safeJsonParse(content);
  const parsed = AIResponseSchema.safeParse(raw);

  if (!parsed.success) {
    return safeAIResponse({
      intent: "unknown",
      reply: "Sorry — I didn’t catch that. Can you say that again?",
      booking: null,
    });
  }

  const out = parsed.data;

  // Normalize booking: if not booking intent, keep booking null to simplify routing
  if (out.intent !== "book") out.booking = null;

  // Ensure reply is not empty
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

    // Return a safe response that won't crash Twilio routes
    return safeAIResponse({
      intent: "unknown",
      reply: "Sorry — I’m having trouble right now. Please try again.",
      booking: null,
    });
  }
}

export async function receptionistVoiceReply({ businessProfile, customerMessage, memory }) {
  try {
    // Slightly shorter for voice (faster + less ramble)
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
      reply: "Sorry — I’m having trouble right now. Please try again.",
      booking: null,
    });
  }
}
