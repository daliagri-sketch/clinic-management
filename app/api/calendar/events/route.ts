import { NextRequest, NextResponse } from 'next/server';
import { CALENDAR_ACCOUNT } from '@/lib/google';
import { getMonthRange, fetchMonthEvents } from '@/lib/calendar';

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

  const [, m] = month.split('-').map(Number);
  if (m < 1 || m > 12) {
    return NextResponse.json({ ok: false, error: 'חודש לא תקין' }, { status: 400 });
  }

  try {
    const { timeMin, timeMax } = getMonthRange(month);
    const events = await fetchMonthEvents(month);

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
