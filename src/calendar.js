import { google } from "googleapis";

let calendarClient = null;

function getCalendarClient() {
  if (calendarClient) return calendarClient;

  try {
    // Parse the service account key from environment variable
    const serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);

    // Create auth client
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccountKey,
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
    });

    // Create calendar client
    calendarClient = google.calendar({ version: "v3", auth });
    
    console.log("✅ Google Calendar client initialized");
    return calendarClient;
  } catch (error) {
    console.error("❌ Error initializing Google Calendar:", error.message);
    throw new Error("Failed to initialize Google Calendar");
  }
}

export function isGoogleConnected() {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
}

export async function createCalendarEvent({ name, service, startISO, endISO, phone }) {
  try {
    const calendar = getCalendarClient();
    const tz = process.env.BUSINESS_TIMEZONE || "America/Denver";

    const event = {
      summary: `${service} - ${name}`,
      description: `Booked via AI receptionist.\nPhone: ${phone}`,
      start: { dateTime: startISO, timeZone: tz },
      end: { dateTime: endISO, timeZone: tz },
    };

    console.log("📅 Creating calendar event:", event);

    const res = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
      requestBody: event,
    });

    console.log("✅ Calendar event created:", res.data.htmlLink);
    return res.data;
  } catch (error) {
    console.error("❌ Error creating calendar event:", error.message);
    throw error;
  }
}

// These functions are no longer needed but kept for backward compatibility
export function getAuthUrl() {
  throw new Error("OAuth not needed - using service account");
}

export function setTokensFromCode() {
  throw new Error("OAuth not needed - using service account");
}