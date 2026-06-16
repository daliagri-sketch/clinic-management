import { NextRequest, NextResponse } from 'next/server';
import { getCalendarClient, CALENDAR_ACCOUNT } from '@/lib/google';

export const dynamic = 'force-dynamic';

// GET /api/calendar/events?month=YYYY-MM
// מושך את כל אירועי החודש מהיומן (קריאה בלבד) ומחזיר JSON גולמי.
// שלב אימות נתונים בלבד — אין כתיבה, אין התאמה למטופלים.
export async function GET(request: NextRequest) {
  const month = request.nextUrl.searchParams.get('month');

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { ok: false, error: 'נדרש פרמטר month בפורמט YYYY-MM (למשל 2026-05)' },
      { status: 400 },
    );
  }

  const [year, m] = month.split('-').map(Number);
  if (m < 1 || m > 12) {
    return NextResponse.json(
      { ok: false, error: 'חודש לא תקין' },
      { status: 400 },
    );
  }

  // גבולות החודש בזמן מקומי של השרת (Asia/Jerusalem במכונה זו),
  // מומרים ל-UTC עבור ה-API. m הוא 1-based, ולכן new Date(year, m, 1)
  // הוא היום הראשון של החודש הבא (כולל גלישה נכונה לדצמבר).
  const start = new Date(year, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, m, 1, 0, 0, 0, 0);
  const timeMin = start.toISOString();
  const timeMax = end.toISOString();

  try {
    const calendar = await getCalendarClient();

    const events: unknown[] = [];
    let pageToken: string | undefined;

    do {
      const res = await calendar.events.list({
        calendarId: CALENDAR_ACCOUNT,
        timeMin,
        timeMax,
        singleEvents: true, // הרחבת אירועים חוזרים למופעים בודדים
        orderBy: 'startTime',
        maxResults: 2500,
        pageToken,
      });
      events.push(...(res.data.items ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return NextResponse.json({
      ok: true,
      calendar: CALENDAR_ACCOUNT,
      month,
      timeMin,
      timeMax,
      count: events.length,
      events,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'שגיאה לא ידועה';
    const noTokens = message.includes('אין tokens');
    return NextResponse.json(
      { ok: false, error: message },
      { status: noTokens ? 401 : 500 },
    );
  }
}
