import type { Patient } from './types';
import type { CalendarEvent } from './calendar';

export type SessionInfo = {
  id: number;
  calendarStatus: string; // scheduled | occurred | cancelled
  paid: string; // unpaid | paid
  paymentMethod: string | null;
  invoiceNumber: string | null;
};

export type MatchRow = {
  eventId: string;
  summary: string;
  date: string; // YYYY-MM-DD (שעון מקומי של האירוע)
  time: string; // HH:MM, ריק לאירוע "כל היום"
  isAllDay: boolean;
  patientId: Patient['id'] | null;
  patientName: string | null;
  patientIcountId: string | null;
  session: SessionInfo | null; // מצורף בצד שרת אם כבר נשמר לסשן
  existingIcountInvoice: string | null; // חשבונית קיימת ב-iCount לאותו לקוח+תאריך
};

// אירועים שלא נכנסים לרשימת ההתאמה — זמן פרטי/לימודים/חופש.
// השוואה לאחר trim ו-toLowerCase כדי לתפוס גם "חופש " עם רווח.
const SKIP_SUMMARIES = [
  'פרטי', 'זמן פרטי', 'לימודים', 'חופש', 'חופשה',
  'ישיבה', 'busy', 'blocked', 'no work',
];

export function isPrivateEvent(summary: string): boolean {
  const s = summary.trim().toLowerCase();
  return SKIP_SUMMARIES.some((k) => s === k || s.startsWith(k + ' ') || s.endsWith(' ' + k));
}

// חילוץ תאריך/שעה מתוך start של אירוע Google.
// dateTime מגיע עם offset מקומי (למשל "2026-05-01T09:00:00+03:00"),
// ולכן מספיק לפצל את המחרוזת כדי לקבל את שעון הקיר המקומי.
function extractDateTime(start: CalendarEvent['start']) {
  if (!start) return { date: '', time: '', isAllDay: false };
  if (start.date) {
    return { date: start.date, time: '', isAllDay: true };
  }
  const dt = start.dateTime ?? '';
  const [datePart, rest] = dt.split('T');
  const time = rest ? rest.slice(0, 5) : '';
  return { date: datePart ?? '', time, isAllDay: false };
}

// בדיקת הכלה: ה-summary מכיל את ה-alias (כיוון אחד בלבד).
// alias.includes(summary) הוסר — הוא גרם לשמות חלקיים (למשל "אדווה") להתאים
// לאליאסים ארוכים יותר ("אדווה יוריש") שהם מטופל אחר לגמרי.
function findByContains(text: string, patients: Patient[]): Patient | null {
  const s = text.trim();
  if (!s) return null;
  for (const p of patients) {
    for (const aliasRaw of p.calendar_aliases ?? []) {
      const alias = (aliasRaw ?? '').trim();
      if (!alias) continue;
      if (s.includes(alias)) {
        return p;
      }
    }
  }
  return null;
}

// ניקוי summary מטקסט שאינו שם: הערה בסוגריים, מילת הפניה (וכל מה שאחריה —
// שם המפנה, לא המטופל), מספרי טלפון ומקפים מפרידים.
export function cleanSummary(summary: string): string {
  let t = summary;
  t = t.replace(/\([^)]*\)/g, ' '); // הערה בסוגריים
  const refIdx = t.search(/הפניה|אשתו של|אישתו של/); // מילת הפניה/קשר
  if (refIdx !== -1) t = t.slice(0, refIdx);
  t = t.replace(/[0-9][0-9\-+]*/g, ' '); // רצף ספרות / טלפון
  t = t.replace(/\s*-\s*/g, ' '); // מקף מפריד
  t = t.replace(/[.,:;]/g, ' '); // סימני פיסוק שנותרו
  return t.replace(/\s+/g, ' ').trim();
}

// התאמה גמישה: קודם על ה-summary הגולמי; אם נכשל ויש טקסט נוסף (טלפון/הפניה),
// מנקים ומנסים לזהות alias בתוך הטקסט הנקי.
export function matchPatient(
  summary: string,
  patients: Patient[],
): Patient | null {
  const raw = summary.trim();
  if (!raw) return null;

  const direct = findByContains(raw, patients);
  if (direct) return direct;

  const cleaned = cleanSummary(raw);
  if (cleaned && cleaned !== raw) {
    return findByContains(cleaned, patients);
  }
  return null;
}

export function buildMatchRows(
  events: CalendarEvent[],
  patients: Patient[],
): MatchRow[] {
  return events
    .filter((ev) => !isPrivateEvent(ev.summary ?? ''))
    .map((ev) => {
    const summary = ev.summary ?? '';
    const { date, time, isAllDay } = extractDateTime(ev.start);
    const match = matchPatient(summary, patients);

    return {
      eventId: ev.id ?? '',
      summary,
      date,
      time,
      isAllDay,
      patientId: match ? match.id : null,
      patientName: match ? match.name ?? '' : null,
      patientIcountId: match ? match.icount_id ?? null : null,
      session: null,
      existingIcountInvoice: null,
    };
  });
}
