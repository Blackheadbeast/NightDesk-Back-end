import express from "express";
import calendarService from "./calendar.js";

const router = express.Router();

router.get("/health", (_req, res) => res.json({ ok: true }));

// Check availability
// router.post("/retell/availability", async (req, res) => {
//   try {
//     const { startISO, durationMinutes = 60 } = req.body || {};
//     if (!startISO) return res.status(400).json({ error: "Missing startISO" });

//     const start = new Date(startISO);
//     const end = new Date(start.getTime() + Number(durationMinutes) * 60 * 1000);

//     const available = await calendarService.isSlotAvailable(start, end);

//     return res.json({ available });
//   } catch (e) {
//     console.error("availability error:", e);
//     return res.status(500).json({ error: "availability_failed" });
//   }
// });
router.post("/retell/availability", async (req, res) => {
  return res.json({ available: true });
});

// Book appointment (double-book safe)
// router.post("/retell/book", async (req, res) => {
//   try {
//     const { startISO, durationMinutes = 60, name, phone, email = "", service = "" } = req.body || {};
//     if (!startISO || !name || !phone) {
//       return res.status(400).json({ error: "Missing startISO/name/phone" });
//     }

//     const start = new Date(startISO);
//     const end = new Date(start.getTime() + Number(durationMinutes) * 60 * 1000);

//     // Final safety check (prevents double booking)
//     const available = await calendarService.isSlotAvailable(start, end);
//     if (!available) return res.status(409).json({ error: "slot_taken" });

//     const result = await calendarService.bookAppointment(start, end, {
//       name,
//       phone,
//       email,
//       notes: service ? `Service: ${service}` : "",
//     });

//     return res.json({ ok: true, result });
//   } catch (e) {
//     console.error("book error:", e);
//     return res.status(500).json({ error: "book_failed" });
//   }
// });

router.post("/retell/book", async (_req, res) => {
  return res.json({ ok: true });
});

export default router;
/* ================================
   END OF FILE
================================ */