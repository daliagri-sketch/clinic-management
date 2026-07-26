import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import type { Patient } from '@/lib/types';
import { fetchMonthEventsSafe } from '@/lib/calendar';
import { matchPatient, isPrivateEvent } from '@/lib/matching';
import { fetchClientDocs, findInvoiceOnDate, type ICountDoc } from '@/lib/icount';
import PatientSessionsView from './patient-sessions-view';
import type { SessionRow } from './patient-sessions-view';

export const dynamic = 'force-dynamic';

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default async function PatientSessionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const month =
    sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : currentMonth;

  // שליפת המטופל
  const { data: patientData, error: patientError } = await supabaseServer
    .from('patients')
    .select('id, name, calendar_aliases, icount_id, default_rate, phone, email')
    .eq('id', id)
    .single();

  if (patientError || !patientData) {
    notFound();
  }

  const patient = patientData as Patient;

  // אירועי החודש → סינון לפי aliases של המטופל.
  // fetchMonthEventsSafe לעולם אינו זורק — אם היומן נכשל נקבל events ריק + error.
  let calendarRows: SessionRow[] = [];
  const { events, error: calendarError } = await fetchMonthEventsSafe(month);

  const mapped: (SessionRow | null)[] = events
    .filter((ev) => !isPrivateEvent(ev.summary ?? ''))
    .map((ev) => {
      const start = ev.start;
      if (!start) return null;
      let date = '';
      let time = '';
      let isAllDay = false;
      if (start.date) {
        date = start.date;
        isAllDay = true;
      } else {
        const dt = start.dateTime ?? '';
        const [datePart, rest] = dt.split('T');
        date = datePart ?? '';
        time = rest ? rest.slice(0, 5) : '';
      }
      const matched = matchPatient(ev.summary ?? '', [patient]);
      if (!matched) return null;
      const row: SessionRow = {
        eventId: ev.id ?? '',
        summary: ev.summary ?? '',
        date,
        time,
        isAllDay,
        session: null,
        existingIcountInvoice: null,
      };
      return row;
    });
  calendarRows = mapped.filter((r): r is SessionRow => r !== null);

  // סשנים קיימים לאותו מטופל + חודש
  const [y, mm] = month.split('-').map(Number);
  const startDate = `${month}-01`;
  const endY = mm === 12 ? y + 1 : y;
  const endM = mm === 12 ? 1 : mm + 1;
  const endDate = `${endY}-${String(endM).padStart(2, '0')}-01`;

  const { data: sessionsData } = await supabaseServer
    .from('sessions')
    .select('id, event_id, date, calendar_status, paid, payment_method, invoice_number')
    .eq('patient_id', id)
    .gte('date', startDate)
    .lt('date', endDate);

  // קיבוץ סשנים לפי event_id
  const sessionByEvent = new Map<
    string,
    NonNullable<typeof sessionsData>[number]
  >();
  for (const s of sessionsData ?? []) {
    sessionByEvent.set(String(s.event_id), s);
  }

  // מיזוג
  calendarRows = calendarRows.map((r) => {
    const s = sessionByEvent.get(r.eventId);
    if (!s) return r;
    return {
      ...r,
      session: {
        id: s.id,
        calendarStatus: s.calendar_status ?? 'scheduled',
        paid: s.paid ?? 'unpaid',
        paymentMethod: s.payment_method,
        invoiceNumber: s.invoice_number,
      },
    };
  });

  // סשנים שנשמרו ידנית אך האירוע אינו בחלון היומן (אירועים שנמחקו מהיומן וכו')
  const calendarEventIds = new Set(calendarRows.map((r) => r.eventId));
  for (const s of sessionsData ?? []) {
    if (!calendarEventIds.has(String(s.event_id))) {
      calendarRows.push({
        eventId: String(s.event_id),
        summary: `(אירוע ${s.event_id})`,
        date: String(s.date),
        time: '',
        isAllDay: false,
        session: {
          id: s.id,
          calendarStatus: s.calendar_status ?? 'scheduled',
          paid: s.paid ?? 'unpaid',
          paymentMethod: s.payment_method,
          invoiceNumber: s.invoice_number,
        },
        existingIcountInvoice: null,
      });
    }
  }

  // מיון לפי תאריך
  calendarRows.sort((a, b) => a.date.localeCompare(b.date));

  // בדיקת חשבוניות קיימות ב-iCount לשורות שמועמדות להנפקה
  let clientDocs: ICountDoc[] = [];
  if (patient.icount_id) {
    try {
      clientDocs = await fetchClientDocs(String(patient.icount_id));
    } catch {
      clientDocs = [];
    }
  }

  calendarRows = calendarRows.map((r) => {
    const s = r.session;
    if (
      s &&
      s.calendarStatus === 'occurred' &&
      s.paid === 'paid' &&
      patient.icount_id &&
      !s.invoiceNumber
    ) {
      return { ...r, existingIcountInvoice: findInvoiceOnDate(clientDocs, r.date) };
    }
    return r;
  });

  const [yy, mmNum] = month.split('-').map(Number);
  const monthLabel = `${HEBREW_MONTHS[mmNum - 1]} ${yy}`;
  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);

  const sessionCount = calendarRows.filter((r) => r.session).length;
  const paidCount = calendarRows.filter((r) => r.session?.paid === 'paid').length;

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>{patient.name ?? 'מטופל'}</h1>
          <div className="patient-meta">
            {patient.icount_id && (
              <span className="meta-chip">iCount: {patient.icount_id}</span>
            )}
            {patient.default_rate && (
              <span className="meta-chip">תעריף: ₪{patient.default_rate}</span>
            )}
            {patient.phone && (
              <span className="meta-chip">{patient.phone}</span>
            )}
          </div>
        </div>
        <Link href="/" className="nav-link">
          ← מטופלים
        </Link>
      </header>

      <nav className="month-nav">
        <Link href={`/patients/${id}?month=${prevMonth}`} className="month-btn">
          חודש קודם
        </Link>
        <span className="month-label">{monthLabel}</span>
        <Link href={`/patients/${id}?month=${nextMonth}`} className="month-btn">
          חודש הבא
        </Link>
      </nav>

      {calendarError && (
        <div className="banner-warning" role="alert">
          ⚠️ לא ניתן לטעון את נתוני היומן ({calendarError}). ייתכן שיש להתחבר מחדש
          ל-Google דרך <code>/api/auth/google</code>. שאר הנתונים מוצגים כרגיל.
        </div>
      )}

      <div className="count-row">
        <span className="count">
          {calendarRows.length} פגישות · {sessionCount} נשמרו · {paidCount} שולמו
        </span>
      </div>

      <PatientSessionsView
        rows={calendarRows}
        patientId={id}
        patientIcountId={patient.icount_id ?? null}
        month={month}
      />
    </main>
  );
}
