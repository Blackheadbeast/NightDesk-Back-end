import express from "express";
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import calendarService from "./calendar.js";
import { parseDateTime } from "./timeParser.js";
import config from "./config.js";

const router = express.Router();
const TOKEN_PATH = path.join(process.cwd(), "google_tokens.json");

/* ================================
   GOOGLE OAUTH (SETUP ROUTES)
================================ */
router.get("/connect/google", (_req, res) => {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  const url = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar"],
  });

  res.redirect(url);
});

router.get("/oauth2/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing code");

    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oAuth2Client.getToken(code);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

    // Make sure calendarService picks up tokens on next call
    calendarService.reset?.();

    res.send("✅ Google Calendar connected successfully! You can close this tab and return to your app.");
  } catch (e) {
    console.error("OAuth callback error:", e);
    res.status(500).send("OAuth error. Check server logs for details.");
  }
});

/* ================================
   HEALTH & STATUS
================================ */
router.get("/health", (_req, res) => res.json({ ok: true }));

router.get("/status", (_req, res) => {
  const hasTokens = fs.existsSync(TOKEN_PATH);
  const tokens = hasTokens ? JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8")) : null;
  
  res.json({
    status: "online",
    googleCalendar: {
      authenticated: hasTokens && !!tokens?.refresh_token,
      setupUrl: hasTokens ? null : `${process.env.BASE_URL}/api/connect/google`
    }
  });
});

/* ================================
   RETELL ROUTES
================================ */

// Check availability (REAL)
router.post("/retell/availability", async (req, res) => {
  try {
    const { startISO, durationMinutes = 60 } = req.body || {};
    if (!startISO) return res.status(400).json({ error: "Missing startISO" });

    const start = new Date(startISO);
    const end = new Date(start.getTime() + Number(durationMinutes) * 60 * 1000);

    const available = await calendarService.isSlotAvailable(start, end);
    return res.json({ available });
  } catch (e) {
    console.error("availability error:", e);
    return res.status(500).json({ error: "availability_failed" });
  }
});

// Book appointment (REAL + double-book safe)
router.post("/retell/book", async (req, res) => {
  try {
    const {
      startISO,
      durationMinutes = 60,
      name,
      phone = "",
      email = "",
      service = "",
    } = req.body || {};

    // phone should NOT be required (Retell may not provide it)
    if (!startISO || !name) {
      return res.status(400).json({ error: "Missing startISO/name" });
    }

    const start = new Date(startISO);
    const end = new Date(start.getTime() + Number(durationMinutes) * 60 * 1000);

    // Final safety check (prevents double booking)
    const available = await calendarService.isSlotAvailable(start, end);
    if (!available) return res.status(409).json({ error: "slot_taken" });

    const result = await calendarService.bookAppointment(start, end, {
      name,
      phone,
      email,
      notes: service ? `Service: ${service}` : "",
    });

    return res.json({ ok: true, result });
  } catch (e) {
    console.error("book error:", e);
    return res.status(500).json({ error: "book_failed" });
  }
});

/* ================================
   VAPI BOOKING ENDPOINT (FINAL)
================================ */
router.post("/vapi/book", async (req, res) => {
  try {
    const {
      customer_name,
      service_type,
      appointment_date,
      appointment_time
    } = req.body;

    console.log("📞 VAPI booking request:", req.body);

    if (!customer_name || !service_type || !appointment_date || !appointment_time) {
      console.log("❌ Missing required fields");
      return res.status(400).json({ 
        success: false, 
        error: "missing_fields",
        message: "Missing required fields: customer_name, service_type, appointment_date, appointment_time"
      });
    }

    // Build start/end time using your existing parser
    const startTime = parseDateTime(appointment_date, appointment_time);
    const duration = config.appointment.defaultDuration;
    const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

    console.log(`⏰ Checking availability: ${startTime.toISOString()} to ${endTime.toISOString()}`);

    // Check if the slot is available
    const available = await calendarService.isSlotAvailable(startTime, endTime);

    if (!available) {
      console.log("❌ Slot not available");
      return res.json({ 
        success: false, 
        message: "That time slot is not available. Please choose another time."
      });
    }

    console.log("✅ Slot is available, booking...");

    const result = await calendarService.bookAppointment(
      startTime,
      endTime,
      {
        name: customer_name,
        phone: "",
        email: "",
        notes: `Service: ${service_type}`
      }
    );

    if (!result.success) {
      console.log("❌ Booking failed:", result);
      return res.json({ 
        success: false,
        message: result.message || "Failed to book appointment"
      });
    }

    console.log("✅ Booking successful!");
    return res.json({ 
      success: true,
      message: `Appointment booked for ${customer_name} on ${appointment_date} at ${appointment_time}`,
      eventId: result.eventId
    });

  } catch (err) {
    console.error("❌ VAPI booking error:", err);
    return res.status(500).json({ 
      success: false, 
      error: "booking_failed",
      message: err.message || "An error occurred while booking"
    });
  }
});


export default router;
/* ================================
   END OF FILE
================================ */