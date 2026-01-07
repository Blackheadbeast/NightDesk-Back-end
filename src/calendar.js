import fs from "fs";
import path from "path";
import { google } from "googleapis";
import config from "./config.js";

const TOKEN_PATH = path.join(process.cwd(), "google_tokens.json");

function loadTokens() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

class CalendarService {
  constructor() {
    this.calendar = null;
    this.oAuth2Client = null;
    this.initialized = false;
  }

  reset() {
    this.calendar = null;
    this.oAuth2Client = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error(
        "Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI"
      );
    }

    const tokens = loadTokens();
    if (!tokens?.refresh_token) {
      throw new Error("No refresh_token found. Visit /api/connect/google first.");
    }

    this.oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    this.oAuth2Client.setCredentials(tokens);

    this.oAuth2Client.on("tokens", (newTokens) => {
      const merged = { ...tokens, ...newTokens };
      saveTokens(merged);
    });

    this.calendar = google.calendar({ version: "v3", auth: this.oAuth2Client });
    this.initialized = true;
  }

  // ✅ best availability check: FreeBusy
  async isSlotAvailable(startTime, endTime) {
    await this.initialize();

    const bufferMs = 5 * 60 * 1000;
    const searchStart = new Date(startTime.getTime() - bufferMs);
    const searchEnd = new Date(endTime.getTime() + bufferMs);

    const fb = await this.calendar.freebusy.query({
      requestBody: {
        timeMin: searchStart.toISOString(),
        timeMax: searchEnd.toISOString(),
        items: [{ id: config.googleCalendar.calendarId }],
      },
    });

    const busy = fb?.data?.calendars?.[config.googleCalendar.calendarId]?.busy || [];
    return busy.length === 0;
  }

  async suggestAlternatives(requestedStart, durationMinutes) {
    const sameDay = await this.findAvailableSlots(requestedStart, durationMinutes, 3);

    if (sameDay.length > 0) {
      return {
        sameDay: sameDay.map((s) => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
          label: `${this.formatDateForVoice(s.start)} at ${this.formatTimeForVoice(s.start)}`,
        })),
        nextDays: [],
      };
    }

    const nextDays = await this.findNextAvailableDays(requestedStart, durationMinutes, 3, 2);
    return {
      sameDay: [],
      nextDays: nextDays.map((d) => ({
        date: d.date.toISOString(),
        dateLabel: this.formatDateForVoice(d.date),
        slots: (d.slots || []).map((s) => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
          label: `${this.formatDateForVoice(s.start)} at ${this.formatTimeForVoice(s.start)}`,
        })),
      })),
    };
  }

  async bookAppointment(startTime, endTime, callerInfo) {
    await this.initialize();

    const durationMinutes = Math.round((endTime - startTime) / 60000);

    const isAvailable = await this.isSlotAvailable(startTime, endTime);
    if (!isAvailable) {
      return {
        success: false,
        reason: "SLOT_TAKEN",
        message: "That time is not available.",
        alternatives: await this.suggestAlternatives(startTime, durationMinutes),
      };
    }

    const event = {
      summary: `Appointment - ${callerInfo.name}`,
      description: `
Phone: ${callerInfo.phone}
Email: ${callerInfo.email || "Not provided"}
Notes: ${callerInfo.notes || "None"}
Booked via: NightDesk AI
      `.trim(),
      start: { dateTime: startTime.toISOString(), timeZone: config.googleCalendar.timeZone },
      end: { dateTime: endTime.toISOString(), timeZone: config.googleCalendar.timeZone },
      attendees: callerInfo.email ? [{ email: callerInfo.email }] : [],
    };

    try {
      const response = await this.calendar.events.insert({
        calendarId: config.googleCalendar.calendarId,
        resource: event,
        sendUpdates: "all",
      });

      return {
        success: true,
        eventId: response.data.id,
        eventLink: response.data.htmlLink,
        message: "Appointment successfully booked",
      };
    } catch (error) {
      const msg = String(error?.message || "").toLowerCase();
      const isConflict = error?.code === 409 || msg.includes("conflict");

      if (isConflict) {
        return {
          success: false,
          reason: "RACE_CONDITION",
          message: "That time was just booked. Here are the next options.",
          alternatives: await this.suggestAlternatives(startTime, durationMinutes),
        };
      }

      console.error("Error booking appointment:", error);
      throw new Error("Failed to book appointment");
    }
  }

  async findAvailableSlots(date, durationMinutes, maxResults = 3) {
    await this.initialize();

    const startHour = config.businessHours?.start ?? 9;
    const endHour = config.businessHours?.end ?? 17;

    const dayStart = new Date(date);
    dayStart.setHours(startHour, 0, 0, 0);

    const dayEnd = new Date(date);
    dayEnd.setHours(endHour, 0, 0, 0);

    const response = await this.calendar.events.list({
      calendarId: config.googleCalendar.calendarId,
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const bookedEvents = response.data.items || [];
    const availableSlots = [];

    const intervalMinutes = 30;
    const durationMs = durationMinutes * 60 * 1000;

    let currentTime = new Date(dayStart);

    while (currentTime < dayEnd && availableSlots.length < maxResults) {
      const slotEnd = new Date(currentTime.getTime() + durationMs);
      if (slotEnd > dayEnd) break;

      const hasConflict = bookedEvents.some((event) => {
        const eventStart = new Date(event.start.dateTime || event.start.date);
        const eventEnd = new Date(event.end.dateTime || event.end.date);

        return (
          (currentTime >= eventStart && currentTime < eventEnd) ||
          (slotEnd > eventStart && slotEnd <= eventEnd) ||
          (currentTime <= eventStart && slotEnd >= eventEnd)
        );
      });

      if (!hasConflict) {
        availableSlots.push({ start: new Date(currentTime), end: new Date(slotEnd) });
      }

      currentTime = new Date(currentTime.getTime() + intervalMinutes * 60 * 1000);
    }

    return availableSlots;
  }

  async findNextAvailableDays(startDate, durationMinutes, maxDays = 3, slotsPerDay = 2) {
    const availableDays = [];
    let currentDate = new Date(startDate);
    let daysChecked = 0;
    const maxDaysToCheck = 14;

    while (availableDays.length < maxDays && daysChecked < maxDaysToCheck) {
      const dayOfWeek = currentDate.getDay();
      const skipWeekends = config.businessHours?.skipWeekends !== false;

      if (skipWeekends && (dayOfWeek === 0 || dayOfWeek === 6)) {
        currentDate.setDate(currentDate.getDate() + 1);
        daysChecked++;
        continue;
      }

      const slots = await this.findAvailableSlots(currentDate, durationMinutes, slotsPerDay);
      if (slots.length > 0) {
        availableDays.push({ date: new Date(currentDate), slots });
      }

      currentDate.setDate(currentDate.getDate() + 1);
      daysChecked++;
    }

    return availableDays;
  }

  formatTimeForVoice(dateTime) {
    return dateTime.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  formatDateForVoice(date) {
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }
}

export default new CalendarService();
/* ================================
   END OF FILE
================================ */