import dotenv from "dotenv";

// Load .env ONLY if it exists (safe for Railway)
dotenv.config();

if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️ OPENAI_API_KEY is not set");
}

if (!process.env.BASE_URL) {
  console.warn("⚠️ BASE_URL is not set");
}

// Google Calendar Configuration
if (!process.env.GOOGLE_CLIENT_EMAIL) {
  console.warn("⚠️ GOOGLE_CLIENT_EMAIL is not set");
}

if (!process.env.GOOGLE_PRIVATE_KEY) {
  console.warn("⚠️ GOOGLE_PRIVATE_KEY is not set");
}

if (!process.env.GOOGLE_CALENDAR_ID) {
  console.warn("⚠️ GOOGLE_CALENDAR_ID is not set");
}

export default {
  // OpenAI Configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
  },

  // Server Configuration
  server: {
    baseUrl: process.env.BASE_URL,
    port: process.env.PORT || 3000,
  },

  // Twilio Configuration (if you're using it)
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
  },

  // Google Calendar Configuration
  googleCalendar: {
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    privateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
    timeZone: process.env.TIMEZONE || 'America/Denver',
  },

  // Business Hours Configuration
  businessHours: {
    start: parseInt(process.env.BUSINESS_HOURS_START) || 9, // 9 AM
    end: parseInt(process.env.BUSINESS_HOURS_END) || 17, // 5 PM
    skipWeekends: process.env.SKIP_WEEKENDS
  ? process.env.SKIP_WEEKENDS === "true"
  : true,
 // Skip weekends by default
  },

  // Appointment Configuration
  appointment: {
    defaultDuration: parseInt(process.env.APPOINTMENT_DURATION) || 60, // Default 60 minutes
  },
};