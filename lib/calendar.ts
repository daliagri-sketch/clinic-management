import 'server-only';

import type { calendar_v3 } from 'googleapis';
import { getCalendarClient, CALENDAR_ACCOUNT } from './google';

export type CalendarEvent = calendar_v3.Schema$Event;

// תוצאת שליפה "בטוחה" של אירועי חודש. אם הקריאה ל-Google נכשלת
// (למשל tokens חסרים/פגי-תוקף), events יהיה ריק ו-error יכיל את ההודעה.
export type MonthEventsResult = {
  events: CalendarEvent[];
  error: string | null;
};

// גבולות החודש בזמן מקומי של השרת (Asia/Jerusalem במכונה זו), מומרים ל-UTC.
// m הוא 1-based, ולכן new Date(year, m, 1) הוא היום הראשון של החודש הבא.
export function getMonthRange(month: string) {
  const [year, m] = month.split('-').map(Number);
  const start = new Date(year, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, m, 1, 0, 0, 0, 0);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

// מושך את כל אירועי החודש (עם pagination), singleEvents=true.
// זורק במקרה כשל (tokens חסרים, שגיאת רשת וכו') — למי שרוצה גרסה שאינה
// זורקת יש את fetchMonthEventsSafe למטה.
export async function fetchMonthEvents(month: string): Promise<CalendarEvent[]> {
  const { timeMin, timeMax } = getMonthRange(month);
  const calendar = await getCalendarClient();

  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ACCOUNT,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500,
      pageToken,
    });
    events.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return events;
}

// עטיפה בטוחה: לעולם אינה זורקת. במקרה כשל מחזירה events ריק + הודעת שגיאה,
// כדי שדף שקורא ליומן ימשיך להיטען גם כשה-Google לא זמין / ה-tokens פגו.
export async function fetchMonthEventsSafe(month: string): Promise<MonthEventsResult> {
  try {
    const events = await fetchMonthEvents(month);
    return { events, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'שגיאה לא ידועה';
    console.error('[calendar] fetchMonthEventsSafe נכשל:', message);
    return { events: [], error: message };
  }
}
