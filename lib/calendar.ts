import 'server-only';

import type { calendar_v3 } from 'googleapis';
import { getCalendarClient, CALENDAR_ACCOUNT } from './google';

export type CalendarEvent = calendar_v3.Schema$Event;

// גבולות החודש בזמן מקומי של השרת (Asia/Jerusalem במכונה זו), מומרים ל-UTC.
// m הוא 1-based, ולכן new Date(year, m, 1) הוא היום הראשון של החודש הבא.
export function getMonthRange(month: string) {
  const [year, m] = month.split('-').map(Number);
  const start = new Date(year, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, m, 1, 0, 0, 0, 0);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

// מושך את כל אירועי החודש (עם pagination), singleEvents=true.
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
