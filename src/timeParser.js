import { DateTime } from "luxon";

// Helpers
function clean(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[\.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripOrdinals(s) {
  return s.replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, "$1");
}

function parseTimeText(timeText) {
  // returns {hour, minute} or null
  const t = clean(timeText);

  // 17:30 or 17:00
  let m = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return { hour, minute };
  }

  // 5pm / 5 pm / 12am / 12 am
  m = t.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (m) {
    let hour = Number(m[1]);
    const ampm = m[2];
    if (hour < 1 || hour > 12) return null;
    if (ampm === "am") hour = hour === 12 ? 0 : hour;
    if (ampm === "pm") hour = hour === 12 ? 12 : hour + 12;
    return { hour, minute: 0 };
  }

  // "5" (last resort) -> assume 5pm? (dangerous)
  // We'll avoid guessing; return null so we ask again.
  return null;
}

function nextWeekday(base, weekday) {
  // weekday: 1=Mon ... 7=Sun
  const delta = (weekday + 7 - base.weekday) % 7;
  return base.plus({ days: delta === 0 ? 7 : delta });
}

function parseDayText(dayText, tz) {
  // returns a DateTime (date only) or null
  let d = clean(dayText);
  d = stripOrdinals(d);

  const now = DateTime.now().setZone(tz);
  const today = now.startOf("day");

  if (!d || d === "today") return today;
  if (d === "tomorrow") return today.plus({ days: 1 });

  // next monday / monday
  const weekdays = {
    monday: 1, mon: 1,
    tuesday: 2, tue: 2, tues: 2,
    wednesday: 3, wed: 3,
    thursday: 4, thu: 4, thurs: 4,
    friday: 5, fri: 5,
    saturday: 6, sat: 6,
    sunday: 7, sun: 7,
  };

  // "next monday"
  let m = d.match(/\bnext\s+(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thurs|friday|fri|saturday|sat|sunday|sun)\b/);
  if (m) {
    const wd = weekdays[m[1]];
    return nextWeekday(today, wd);
  }

  // plain weekday "monday"
  m = d.match(/\b(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thurs|friday|fri|saturday|sat|sunday|sun)\b/);
  if (m) {
    const wd = weekdays[m[1]];
    // choose next occurrence INCLUDING today if later time is handled elsewhere; safest: if weekday==today, keep today
    const delta = (wd + 7 - today.weekday) % 7;
    return today.plus({ days: delta });
  }

  // ISO date 2026-01-04
  const iso = DateTime.fromISO(d, { zone: tz });
  if (iso.isValid) return iso.startOf("day");

  // numeric dates: 1/4 or 01/04 (assume US M/D)
  const fmtMDY = [
    "M/d",
    "MM/dd",
    "M/d/yy",
    "MM/dd/yy",
    "M/d/yyyy",
    "MM/dd/yyyy",
  ];
  for (const f of fmtMDY) {
    const dt = DateTime.fromFormat(d, f, { zone: tz });
    if (dt.isValid) {
      let candidate = dt.startOf("day");
      // If no year was provided, Luxon may default current year; ensure future if already passed
      if (!d.match(/\b\d{4}\b/) && candidate < today) {
        candidate = candidate.plus({ years: 1 });
      }
      return candidate;
    }
  }

  // month name: "january 4", "jan 4"
  const fmtMonth = ["LLLL d", "LLL d", "LLLL d yyyy", "LLL d yyyy"];
  for (const f of fmtMonth) {
    const dt = DateTime.fromFormat(d, f, { zone: tz });
    if (dt.isValid) {
      let candidate = dt.startOf("day");
      if (!d.match(/\b\d{4}\b/) && candidate < today) {
        candidate = candidate.plus({ years: 1 });
      }
      return candidate;
    }
  }

  return null;
}

export function buildBookingISO({ dayText, timeText, durationMins }) {
  const tz = process.env.BUSINESS_TIMEZONE || "America/Denver";

  const date = parseDayText(dayText, tz);
  const time = parseTimeText(timeText);

  if (!date || !time) return null;

  const start = date.set({ hour: time.hour, minute: time.minute }).setZone(tz);

  if (!start.isValid) return null;

  const end = start.plus({ minutes: Number(durationMins || 30) });

  return {
    startISO: start.toISO({ suppressMilliseconds: true }),
    endISO: end.toISO({ suppressMilliseconds: true }),
  };
}
