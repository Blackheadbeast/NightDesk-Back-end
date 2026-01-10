import { DateTime } from "luxon";

// Helpers
function clean(s) {
  let out = (s || "")
    .toLowerCase()
    // keep ":" for times, but remove punctuation into spaces
    .replace(/[\.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // ✅ Normalize "p m" -> "pm", "a m" -> "am" (fixes "p.m." / "a.m.")
  out = out
    .replace(/\b([ap])\s+m\b/g, "$1m") // "p m" -> "pm"
    .replace(/\b([ap])m\b/g, "$1m");   // keep consistent

  return out;
}

function stripOrdinals(s) {
  return s.replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, "$1");
}

function to24Hour(hour, ampm) {
  const h = Number(hour);
  const p = String(ampm || "").toLowerCase();

  if (h < 1 || h > 12) return null;

  if (p === "am") return h === 12 ? 0 : h;       // 12am -> 0
  if (p === "pm") return h === 12 ? 12 : h + 12; // 12pm -> 12, 1pm -> 13

  return null;
}

function parseTimeText(timeText) {
  // returns {hour, minute} or null
  const t = clean(timeText);

  // ✅ 3:30pm / 3:30 pm / 12:05am etc (AM/PM with minutes)
  let m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (m) {
    const hour12 = Number(m[1]);
    const minute = m[2] ? Number(m[2]) : 0;
    const ampm = m[3].toLowerCase();

    if (minute < 0 || minute > 59) return null;

    const hour24 = to24Hour(hour12, ampm);
    if (hour24 === null) return null;

    return { hour: hour24, minute };
  }

  // ✅ 17:30 or 17:00 (24-hour format)
  m = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  // ✅ 5 o'clock / 5 oclock
  m = t.match(/\b(\d{1,2})\s*o\s*clock\b/i);
  if (m) {
    let hour = Number(m[1]);
    if (hour < 1 || hour > 12) return null;

    // Smart default
    if (hour >= 1 && hour <= 8) hour += 12; // 1pm-8pm
    return { hour, minute: 0 };
  }

  // ✅ Just a number like "5" or "8"
  m = t.match(/\b(\d{1,2})\b/);
  if (m) {
    let hour = Number(m[1]);
    if (hour < 1 || hour > 12) return null;

    // Smart default: PM for 1-8, AM for 9-12
    if (hour >= 1 && hour <= 8) hour += 12;
    return { hour, minute: 0 };
  }

  return null;
}

function nextWeekday(base, weekday) {
  // weekday: 1=Mon ... 7=Sun
  const delta = (weekday + 7 - base.weekday) % 7;
  return base.plus({ days: delta === 0 ? 7 : delta });
}

function parseDayText(dayText, tz) {
  let d = clean(dayText);
  d = stripOrdinals(d);

  const now = DateTime.now().setZone(tz);
  const today = now.startOf("day");

  if (!d || d === "today") return today;
  if (d === "tomorrow") return today.plus({ days: 1 });

  const weekdays = {
    monday: 1, mon: 1,
    tuesday: 2, tue: 2, tues: 2,
    wednesday: 3, wed: 3,
    thursday: 4, thu: 4, thurs: 4,
    friday: 5, fri: 5,
    saturday: 6, sat: 6,
    sunday: 7, sun: 7,
  };

  let m = d.match(/\bnext\s+(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thurs|friday|fri|saturday|sat|sunday|sun)\b/);
  if (m) {
    const wd = weekdays[m[1]];
    return nextWeekday(today, wd);
  }

  m = d.match(/\b(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thurs|friday|fri|saturday|sat|sunday|sun)\b/);
  if (m) {
    const wd = weekdays[m[1]];
    const delta = (wd + 7 - today.weekday) % 7;
    return today.plus({ days: delta });
  }

  const iso = DateTime.fromISO(d, { zone: tz });
  if (iso.isValid) return iso.startOf("day");

  const fmtMDY = ["M/d", "MM/dd", "M/d/yy", "MM/dd/yy", "M/d/yyyy", "MM/dd/yyyy"];
  for (const f of fmtMDY) {
    const dt = DateTime.fromFormat(d, f, { zone: tz });
    if (dt.isValid) {
      let candidate = dt.startOf("day");
      if (!d.match(/\b\d{4}\b/) && candidate < today) candidate = candidate.plus({ years: 1 });
      return candidate;
    }
  }

  const fmtMonth = ["LLLL d", "LLL d", "LLLL d yyyy", "LLL d yyyy"];
  for (const f of fmtMonth) {
    const dt = DateTime.fromFormat(d, f, { zone: tz });
    if (dt.isValid) {
      let candidate = dt.startOf("day");
      if (!d.match(/\b\d{4}\b/) && candidate < today) candidate = candidate.plus({ years: 1 });
      return candidate;
    }
  }

  return null;
}

export function parseDateTime(dayText, timeText) {
  const tz = process.env.BUSINESS_TIMEZONE || "America/Denver";

  const date = parseDayText(dayText, tz);
  const time = parseTimeText(timeText);

  if (!date || !time) {
    throw new Error(`Unable to parse date/time: dayText="${dayText}" timeText="${timeText}"`);
  }

  const dateTime = date.set({ hour: time.hour, minute: time.minute });
  if (!dateTime.isValid) {
    throw new Error(`Invalid date/time combination: dayText="${dayText}" timeText="${timeText}"`);
  }

  return dateTime.toJSDate();
}

export function buildBookingISO({ dayText, timeText, durationMins }) {
  const tz = process.env.BUSINESS_TIMEZONE || "America/Denver";

  const date = parseDayText(dayText, tz);
  const time = parseTimeText(timeText);

  if (!date || !time) return null;

  const start = date.set({ hour: time.hour, minute: time.minute });
  if (!start.isValid) return null;

  const end = start.plus({ minutes: Number(durationMins || 30) });

  return {
    startISO: start.toISO({ suppressMilliseconds: true }),
    endISO: end.toISO({ suppressMilliseconds: true }),
  };
}