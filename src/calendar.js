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
  } catch (e) {
    console.error("Failed saving refreshed tokens:", e.message);
  }
});

function loadTokens() {
  if (fs.existsSync(TOKEN_PATH)) {
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    oAuth2Client.setCredentials(tokens);
    return tokens;
  }
  return null;
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  oAuth2Client.setCredentials(tokens);
}

export function isGoogleConnected() {
  return !!loadTokens();
}

export function getAuthUrl() {
  const scopes = ["https://www.googleapis.com/auth/calendar.events"];
  return oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
  });
}

export async function setTokensFromCode(code) {
  const { tokens } = await oAuth2Client.getToken(code);
  saveTokens(tokens);
  return tokens;
}

function calendarClient() {
  const tokens = loadTokens();
  if (!tokens) throw new Error("Google Calendar not connected.");
  return google.calendar({ version: "v3", auth: oAuth2Client });
}

export async function createCalendarEvent({ name, service, startISO, endISO, phone }) {
  const cal = calendarClient();

  const tz = process.env.BUSINESS_TIMEZONE || "America/Denver";

  const event = {
    summary: `${service} - ${name}`,
    description: `Booked via AI receptionist.\nPhone: ${phone}`,
    start: { dateTime: startISO, timeZone: tz },
    end: { dateTime: endISO, timeZone: tz },
  };

  const res = await cal.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
    requestBody: event,
  });

  return res.data;
}
