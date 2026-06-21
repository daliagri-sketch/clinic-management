import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';
import type { Patient } from '@/lib/types';
import { fetchMonthEvents } from '@/lib/calendar';
import { buildMatchRows } from '@/lib/matching';
import { autoMatchFromICount } from '@/lib/auto-match';
import { fetchClientDocs, findInvoiceOnDate, type ICountDoc } from '@/lib/icount';
import MatchingView from './matching-view';

export const dynamic = 'force-dynamic';

const HEBREW_MONTHS = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
];

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default async function MatchingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const month =
    sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : currentMonth;

  // מטופלים (צד שרת)
  const { data: patientsData, error: patientsError } = await supabaseServer
    .from('patients')
    .select('id, name, calendar_aliases, icount_id')
    .order('name', { ascending: true });

  if (patientsError) {
    return (
      <main className="page">
        <h1>התאמה חודשית</h1>
        <p className="error">שגיאה בטעינת המטופלים: {patientsError.message}</p>
      </main>
    );
  }

  const patients = (patientsData ?? []) as Patient[];

  // אירועי החודש (צד שרת) + התאמה
  let rows;
  try {
    const events = await fetchMonthEvents(month);
    rows = buildMatchRows(events, patients);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'שגיאה לא ידועה';
    return (
      <main className="page">
        <h1>התאמה חודשית</h1>
        <p className="error">שגיאה בטעינת אירועי היומן: {message}</p>
      </main>
    );
  }

  // התאמה אוטומטית מ-iCount לאירועים שלא זוהו — עשוי להוסיף מטופלים חדשים
  const auto = await autoMatchFromICount(rows, patients);
  rows = auto.rows;
  const allPatients = [...patients, ...auto.addedPatients];

  // סשנים קיימים בחודש — מצורפים לשורות שכבר נשמרו
  const [y, mm] = month.split('-').map(Number);
  const startDate = `${month}-01`;
  const endY = mm === 12 ? y + 1 : y;
  const endM = mm === 12 ? 1 : mm + 1;
  const endDate = `${endY}-${String(endM).padStart(2, '0')}-01`;

  const { data: sessionsData } = await supabaseServer
    .from('sessions')
    .select(
      'id, event_id, date, patient_id, calendar_status, paid, payment_method, invoice_number',
    )
    .gte('date', startDate)
    .lt('date', endDate);

  // קיבוץ סשנים לפי event_id|date (יכול להיות יותר מאחד לזוגות)
  const sessionsByEvent = new Map<string, NonNullable<typeof sessionsData>>();
  for (const s of sessionsData ?? []) {
    const key = `${s.event_id}|${s.date}`;
    const list = sessionsByEvent.get(key) ?? [];
    list.push(s);
    sessionsByEvent.set(key, list);
  }

  const patientById = new Map(allPatients.map((p) => [String(p.id), p]));

  rows = rows.map((r) => {
    const list = sessionsByEvent.get(`${r.eventId}|${r.date}`);
    if (!list || list.length === 0) return r;
    // מעדיפים סשן ששייך למטופל שהותאם אוטומטית; אחרת — הראשון (שיוך ידני)
    const s =
      list.find((x) => String(x.patient_id) === String(r.patientId)) ?? list[0];
    const p = patientById.get(String(s.patient_id));
    return {
      ...r,
      patientId: r.patientId ?? s.patient_id,
      patientName: r.patientName ?? p?.name ?? null,
      patientIcountId: r.patientIcountId ?? p?.icount_id ?? null,
      session: {
        id: s.id,
        calendarStatus: s.calendar_status ?? 'scheduled',
        paid: s.paid ?? 'unpaid',
        paymentMethod: s.payment_method,
        invoiceNumber: s.invoice_number,
      },
    };
  });

  // לשורות שמועמדות להנפקה (occurred + paid + icount_id + אין invoice בסשן) —
  // בדיקה ב-iCount אם כבר קיימת חשבונית לאותו client_id ותאריך (מניעת כפילות).
  const docsByClient = new Map<string, ICountDoc[]>();
  const checkedRows = [];
  for (const r of rows) {
    const s = r.session;
    if (
      s &&
      s.calendarStatus === 'occurred' &&
      s.paid === 'paid' &&
      r.patientIcountId &&
      !s.invoiceNumber
    ) {
      let docs = docsByClient.get(r.patientIcountId);
      if (!docs) {
        try {
          docs = await fetchClientDocs(r.patientIcountId);
        } catch {
          docs = [];
        }
        docsByClient.set(r.patientIcountId, docs);
      }
      checkedRows.push({
        ...r,
        existingIcountInvoice: findInvoiceOnDate(docs, r.date),
      });
    } else {
      checkedRows.push(r);
    }
  }
  rows = checkedRows;

  const matchedCount = rows.filter((r) => r.patientId != null).length;
  const unmatchedCount = rows.length - matchedCount;

  const patientOptions = allPatients.map((p) => ({
    id: p.id,
    name: p.name ?? '',
  }));

  const [yy, mmNum] = month.split('-').map(Number);
  const monthLabel = `${HEBREW_MONTHS[mmNum - 1]} ${yy}`;
  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);

  return (
    <main className="page">
      <header className="page-header">
        <h1>התאמה חודשית</h1>
        <span className="count">
          {rows.length} אירועים · {matchedCount} מזוהים · {unmatchedCount} לא
          זוהו
        </span>
        <Link href="/" className="nav-link">
          ← מטופלים
        </Link>
      </header>

      <nav className="month-nav">
        <Link href={`/matching?month=${prevMonth}`} className="month-btn">
          חודש קודם
        </Link>
        <span className="month-label">{monthLabel}</span>
        <Link href={`/matching?month=${nextMonth}`} className="month-btn">
          חודש הבא
        </Link>
      </nav>

      <MatchingView rows={rows} patients={patientOptions} />
    </main>
  );
}
