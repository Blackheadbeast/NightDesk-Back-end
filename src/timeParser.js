import { DateTime } from "luxon";

const TZ = process.env.BUSINESS_TIMEZONE || "America/Denver";

const ORDINALS = [
  ["first", 1], ["second", 2], ["third", 3], ["fourth", 4], ["fifth", 5],
  ["sixth", 6], ["seventh", 7], ["eighth", 8], ["ninth", 9], ["tenth", 10],
  ["eleventh", 11], ["twelfth", 12], ["thirteenth", 13], ["fourteenth", 14],
  ["fifteenth", 15], ["sixteenth", 16], ["seventeenth", 17], ["eighteenth", 18],
  ["nineteenth", 19], ["twentieth", 20], ["twenty first", 21], ["twenty-first", 21],
  ["twenty second", 22], ["twenty-second", 22], ["twenty third", 23], ["twenty-third", 23],
  ["twenty fourth", 24], ["twenty-fourth", 24], ["twenty fifth", 25], ["twenty-fifth", 25],
  ["twenty sixth", 26], ["twenty-sixth", 26], ["twenty seventh", 27], ["twenty-seventh", 27],
  ["twenty eighth", 28], ["twenty-eighth", 28], ["twenty ninth", 29], ["twenty-ninth", 29],
  ["thirtieth", 30], ["thirty first", 31], ["thirty-first", 31],
];

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripOrdSuffix(s) {
  // 26th -> 26
  return s.replace(/(\d+)(st|nd|rd|th)\b/g, "$1");
}

function parseSpokenDayNumber(text) {
  const t = normalize(text);
  for (const [phrase, num] of ORDINALS) {
    if (t.includes(phrase)) return num;
  }
  return null;
}

function parseDay(dayText) {
  const now = DateTime.now().setZone(TZ).startOf("day");
  if (!dayText) return null;

  let d = normalize(dayText);
  d = stripOrdSuffix(d);

  if (d === "today") return now;
  if (d === "tomorrow") return now.plus({ days: 1 });

  // weekdays
  const weekdays = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
  const w = weekdays.indexOf(d);
  if (w !== -1) {
    const todayIdx = now.weekday - 1; // Mon=1..Sun=7
    let delta = w - todayIdx;
    if (delta <= 0) delta += 7;
    return now.plus({ days: delta });
  }

  // mm/dd or mm-dd (assume current year)
  const mdy = d.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (mdy) {
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    const dt = DateTime.fromObject({ year: now.year, month, day }, { zone: TZ }).startOf("day");
    return dt.isValid ? dt : null;
  }

  // "dec 26" / "december 26"
  const monthDayNum = d.match(/^([a-z]+)\s+(\d{1,2})$/);
  if (monthDayNum) {
    const monthName = monthDayNum[1];
    const day = Number(monthDayNum[2]);

    let dt = DateTime.fromFormat(`${monthName} ${day} ${now.year}`, "LLLL d yyyy", { zone: TZ });
    if (!dt.isValid) dt = DateTime.fromFormat(`${monthName} ${day} ${now.year}`, "LLL d yyyy", { zone: TZ });
    return dt.isValid ? dt.startOf("day") : null;
  }

  // "december twenty sixth"
  const monthSpoken = d.match(/^([a-z]+)\s+(.+)$/);
  if (monthSpoken) {
    const monthName = monthSpoken[1];
    const rest = monthSpoken[2];
    const dayNum = parseSpokenDayNumber(rest);
    if (dayNum) {
      let dt = DateTime.fromFormat(`${monthName} ${dayNum} ${now.year}`, "LLLL d yyyy", { zone: TZ });
      if (!dt.isValid) dt = DateTime.fromFormat(`${monthName} ${dayNum} ${now.year}`, "LLL d yyyy", { zone: TZ });
      return dt.isValid ? dt.startOf("day") : null;
    }
  }

  return null;
}

function parseTime(timeText) {
  if (!timeText) return null;

  let t = normalize(timeText);

  // remove filler words
  t = t.replace(/\b(at|for|around)\b/g, " ").replace(/\s+/g, " ").trim();

  // handle "2 p m" -> "2pm"
  t = t.replace(/\b(a m|a\.m\.|am)\b/g, "am").replace(/\b(p m|p\.m\.|pm)\b/g, "pm");
  t = t.replace(/\s+/g, "");
  t = stripOrdSuffix(t);

  // 14:30
  if (/^\d{1,2}:\d{2}$/.test(t)) {
    const [h, m] = t.split(":").map(Number);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return { hour: h, minute: m };
    return null;
  }

  // 2:30pm
  const ampmColon = t.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (ampmColon) {
    let hour = Number(ampmColon[1]);
    const minute = Number(ampmColon[2]);
    const mer = ampmColon[3];
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    if (mer === "am") {
      if (hour === 12) hour = 0;
    } else {
      if (hour !== 12) hour += 12;
    }
    return { hour, minute };
  }

  // 2pm / 12am
  const ampm = t.match(/^(\d{1,2})(am|pm)$/);
  if (ampm) {
    let hour = Number(ampm[1]);
    const mer = ampm[2];
    if (hour < 1 || hour > 12) return null;
    if (mer === "am") {
      if (hour === 12) hour = 0;
    } else {
      if (hour !== 12) hour += 12;
    }
    return { hour, minute: 0 };
  }

  // 14
  if (/^\d{1,2}$/.test(t)) {
    const h = Number(t);
    if (h >= 0 && h <= 23) return { hour: h, minute: 0 };
  }

  return null;
}

export function buildBookingISO({ dayText, timeText, durationMins }) {
  const day = parseDay(dayText);
  const time = parseTime(timeText);

  if (!day || !time) return null;

  const start = day.set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 });
  if (!start.isValid) return null;

  const end = start.plus({ minutes: durationMins || 30 });

  return {
    startISO: start.toISO(),
    endISO: end.toISO(),
  };
}
