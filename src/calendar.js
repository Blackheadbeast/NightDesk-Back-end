import { google } from "googleapis";
import fs from "fs";
import path from "path";

const TOKEN_PATH = path.join(process.cwd(), "google_tokens.json");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing. Check .env loading.`);
  return v;
}

const oAuth2Client = new google.auth.OAuth2(
  requireEnv("GOOGLE_CLIENT_ID"),
  requireEnv("GOOGLE_CLIENT_SECRET"),
  requireEnv("GOOGLE_REDIRECT_URI")
);

// Auto-save refreshed tokens
oAuth2Client.on("tokens", (tokens) => {
  if (!tokens) return;

  // Merge with existing tokens so refresh_token doesn't get lost
  const existing = loadTokens() || {};
  const merged = { ...existing, ...tokens };

  try {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
    console.log("✅ Tokens refreshed and saved");
  } catch (e) {
    console.error("Failed saving refreshed tokens:", e.message);
  }
});

function loadTokens() {
  if (fs.existsSync(TOKEN_PATH)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
      oAuth2Client.setCredentials(tokens);
      console.log("✅ Loaded existing tokens");
      return tokens;
    } catch (e) {
      console.error("Error loading tokens:", e.message);
      return null;
    }
  }
  return null;
}

function saveTokens(tokens) {
  try {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    oAuth2Client.setCredentials(tokens);
    console.log("✅ Tokens saved successfully");
  } catch (e) {
    console.error("Error saving tokens:", e.message);
    throw e;
  }
}

export function isGoogleConnected() {
  const tokens = loadTokens();
  return !!tokens;
}

export function getAuthUrl() {
  const scopes = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar"
  ];
  
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
    redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
    // Add these for better compatibility
    response_type: "code",
    include_granted_scopes: true
  });
  
  console.log("🔗 Generated auth URL:", authUrl);
  return authUrl;
}

export async function setTokensFromCode(code) {
  if (!code) {
    throw new Error("Authorization code is required");
  }
  
  console.log("🔄 Exchanging code for tokens...");
  
  try {
    const { tokens } = await oAuth2Client.getToken({
      code,
      redirect_uri: requireEnv("GOOGLE_REDIRECT_URI")
    });
    
    console.log("✅ Received tokens from Google");
    saveTokens(tokens);
    return tokens;
  } catch (error) {
    console.error("❌ Error getting tokens:", error.message);
    throw new Error(`Failed to exchange authorization code: ${error.message}`);
  }
}

function calendarClient() {
  const tokens = loadTokens();
  if (!tokens) {
    throw new Error("Google Calendar not connected. Please authorize first.");
  }
  return google.calendar({ version: "v3", auth: oAuth2Client });
}

export async function createCalendarEvent({ name, service, startISO, endISO, phone }) {
  try {
    const cal = calendarClient();
    const tz = process.env.BUSINESS_TIMEZONE || "America/Denver";

    const event = {
      summary: `${service} - ${name}`,
      description: `Booked via AI receptionist.\nPhone: ${phone}`,
      start: { dateTime: startISO, timeZone: tz },
      end: { dateTime: endISO, timeZone: tz },
    };

    console.log("📅 Creating calendar event:", event);

    const res = await cal.events.insert({
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

// Helper function to check if tokens are expired
export function areTokensExpired() {
  const tokens = loadTokens();
  if (!tokens || !tokens.expiry_date) return true;
  return tokens.expiry_date <= Date.now();
}

// Helper function to manually refresh tokens if needed
export async function refreshTokensIfNeeded() {
  if (areTokensExpired()) {
    console.log("🔄 Tokens expired, refreshing...");
    try {
      const { credentials } = await oAuth2Client.refreshAccessToken();
      saveTokens(credentials);
      console.log("✅ Tokens refreshed successfully");
      return credentials;
    } catch (error) {
      console.error("❌ Error refreshing tokens:", error.message);
      throw error;
    }
  }
  return loadTokens();
}