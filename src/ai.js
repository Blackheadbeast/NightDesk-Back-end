import OpenAI from "openai";
import { z } from "zod";
import { DateTime } from "luxon";

let client = null;

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is missing. Check .env loading.");
  if (!client) client = new OpenAI({ apiKey: key });
  return client;
}

const AiResponseSchema = z.object({
  intent: z.enum(["faq", "book", "reschedule", "cancel", "unknown"]),
  reply: z.string(),
  booking: z
    .object({
      name: z.string().optional().default(""),
      service: z.string().optional().default(""),
      dayText: z.string().optional().default(""),
      timeText: z.string().optional().default(""),
    })
    .nullable(),
});

export async function receptionistReply({ businessProfile, customerMessage, memory }) {
  const openai = getClient();

  const tz = process.env.BUSINESS_TIMEZONE || "America/Denver";
  const nowLocal = DateTime.now().setZone(tz);
  const todayText = nowLocal.toFormat("cccc, LLLL d, yyyy");
  const nowIsoWithOffset = nowLocal.toISO();

  const system = `
You are an AI receptionist for a small business.

Style:
- Be brief and clear (1–2 short sentences).
- Ask ONE question at a time if info is missing.
- Do NOT mention JSON/schema/dev details.

Booking requirements:
- To book, confirm: name, service, day, time.
- Services:
  - Haircut (30m)
  - Beard trim (15m)
  - Haircut+Beard (45m)
- Business timezone: ${tz}
- Now in business timezone: ${nowIsoWithOffset}
- Today’s local date: ${todayText}
- “tomorrow” means the next day AFTER ${todayText} in ${tz}.

IMPORTANT:
- Do NOT output startISO/endISO. The server will compute them.
- When booking is ready, fill booking.dayText and booking.timeText with the user's wording (e.g. "tomorrow", "friday", "12/25", "2pm").

Return JSON ONLY in exactly this format:
{
  "intent": "faq" | "book" | "reschedule" | "cancel" | "unknown",
  "reply": "text to say to the customer",
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

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: customerMessage || "" },
    ],
    response_format: { type: "json_object" },
    max_tokens: 160,
    temperature: 0.2,
  });

  const content = resp.choices?.[0]?.message?.content || "{}";

  try {
    const raw = JSON.parse(content);
    const parsed = AiResponseSchema.safeParse(raw);

    if (!parsed.success) {
      return {
        intent: "unknown",
        reply: "Sorry—what day and time would you like, and what service?",
        booking: null,
      };
    }

    const data = parsed.data;

    // If intent book but missing fields, force booking null so routes ask next question
    if (
      data.intent === "book" &&
      (!data.booking?.service || !data.booking?.dayText || !data.booking?.timeText || !data.booking?.name)
    ) {
      return { ...data, booking: null };
    }

    return data;
  } catch {
    return {
      intent: "unknown",
      reply: "Sorry—what day and time would you like, and what service?",
      booking: null,
    };
  }
}

export async function receptionistVoiceReply({ businessProfile, customerMessage, memory }) {
  return receptionistReply({ businessProfile, customerMessage, memory });
}
