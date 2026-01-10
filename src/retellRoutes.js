import express from "express";
import calendarService from "./calendar.js";

const router = express.Router();

router.get("/health", (_req, res) => res.json({ ok: true }));

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

// ================================
// VAPI BOOKING ENDPOINT (FINAL)
// ================================
router.post("/vapi/book", async (req, res) => {
  try {
    const {
      customer_name,
      service_type,
      appointment_date,
      appointment_time
    } = req.body;

    if (!customer_name || !service_type || !appointment_date || !appointment_time) {
      return res.status(400).json({ success: false, error: "missing_fields" });
    }

    // Build start/end time using your existing parser
    const startTime = parseDateTime(appointment_date, appointment_time);
    const duration = config.appointment.defaultDuration;
    const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

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
      return res.status(409).json({ success: false });
    }

    return res.json({ success: true });

  } catch (err) {
    console.error("❌ VAPI booking error:", err);
    return res.status(500).json({ success: false });
  }
});


export default router;
