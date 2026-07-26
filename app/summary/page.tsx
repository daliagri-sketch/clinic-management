import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';

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

type PatientSummary = {
  id: string;
  name: string;
  defaultRate: number | null;
  total: number;
  occurred: number;
  paid: number;
  unpaidOccurred: number; // התקיימו אך לא שולמו
  invoiced: number;
  totalAmount: number;
  unpaidAmount: number;
};

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : currentMonth;

  const [y, mm] = month.split('-').map(Number);
  const startDate = `${month}-01`;
  const endY = mm === 12 ? y + 1 : y;
  const endM = mm === 12 ? 1 : mm + 1;
  const endDate = `${endY}-${String(endM).padStart(2, '0')}-01`;

  // סשנים + מטופלים לחודש
  const { data: sessionsData, error } = await supabaseServer
    .from('sessions')
    .select(
      'id, patient_id, calendar_status, paid, payment_method, invoice_number, patients(id, name, default_rate)',
    )
    .gte('date', startDate)
    .lt('date', endDate);

  if (error) {
    return (
      <main className="page">
        <h1>סיכום חודשי</h1>
        <p className="msg-error">שגיאה: {error.message}</p>
      </main>
    );
  }

  // קיבוץ לפי מטופל
  const byPatient = new Map<string, PatientSummary>();

  for (const s of sessionsData ?? []) {
    const p = (Array.isArray(s.patients) ? s.patients[0] : s.patients) as { id: string; name: string | null; default_rate: number | null } | null;
    if (!p) continue;
    const pid = String(p.id);

    if (!byPatient.has(pid)) {
      byPatient.set(pid, {
        id: pid,
        name: p.name ?? '—',
        defaultRate: p.default_rate ?? null,
        total: 0,
        occurred: 0,
        paid: 0,
        unpaidOccurred: 0,
        invoiced: 0,
        totalAmount: 0,
        unpaidAmount: 0,
      });
    }

    const row = byPatient.get(pid)!;
    const rate = p.default_rate ?? 0;

    row.total += 1;
    if (s.calendar_status === 'occurred') {
      row.occurred += 1;
      if (s.paid === 'paid') {
        row.paid += 1;
        row.totalAmount += rate;
        if (s.invoice_number) row.invoiced += 1;
      } else {
        row.unpaidOccurred += 1;
        row.unpaidAmount += rate;
      }
    }
  }

  const rows = [...byPatient.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'he'),
  );

  const totalOccurred = rows.reduce((s, r) => s + r.occurred, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);
  const totalAmount = rows.reduce((s, r) => s + r.totalAmount, 0);
  const totalUnpaid = rows.reduce((s, r) => s + r.unpaidAmount, 0);

  const [yy, mmNum] = month.split('-').map(Number);
  const monthLabel = `${HEBREW_MONTHS[mmNum - 1]} ${yy}`;
  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);

  return (
    <main className="page">
      <header className="page-header">
        <h1>סיכום חודשי</h1>
        <div className="header-links">
          <Link href="/matching" className="nav-link">התאמה חודשית</Link>
          <Link href="/" className="nav-link">← מטופלים</Link>
        </div>
      </header>

      <nav className="month-nav">
        <Link href={`/summary?month=${prevMonth}`} className="month-btn">חודש קודם</Link>
        <span className="month-label">{monthLabel}</span>
        <Link href={`/summary?month=${nextMonth}`} className="month-btn">חודש הבא</Link>
      </nav>

      {rows.length === 0 ? (
        <p className="muted" style={{ padding: '24px 0' }}>
          אין פגישות שמורות לחודש זה. שמור פגישות במסך ההתאמה.
        </p>
      ) : (
        <>
          <div className="summary-totals">
            <span className="summary-total-chip">
              {rows.length} מטופלים
            </span>
            <span className="summary-total-chip">
              {totalOccurred} פגישות שהתקיימו
            </span>
            <span className="summary-total-chip paid-chip">
              ₪{totalAmount.toLocaleString()} התקבל
            </span>
            {totalUnpaid > 0 && (
              <span className="summary-total-chip unpaid-chip">
                ₪{totalUnpaid.toLocaleString()} חוב פתוח
              </span>
            )}
          </div>

          <div className="table-wrap">
            <table className="patients-table summary-table">
              <thead>
                <tr>
                  <th>מטופל</th>
                  <th>פגישות</th>
                  <th>שולמו</th>
                  <th>חוב פתוח</th>
                  <th>הונפקו חשבוניות</th>
                  <th>סה״כ התקבל</th>
                  <th>סה״כ לגבייה</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.unpaidOccurred > 0 ? 'has-debt' : ''}>
                    <td className="patient-name-cell">
                      <Link href={`/patients/${r.id}?month=${month}`} className="patient-name-link">
                        {r.name}
                      </Link>
                    </td>
                    <td>{r.occurred > 0 ? r.occurred : <span className="cell-empty">—</span>}</td>
                    <td>{r.paid > 0 ? r.paid : <span className="cell-empty">—</span>}</td>
                    <td>
                      {r.unpaidOccurred > 0 ? (
                        <span className="debt-count">{r.unpaidOccurred}</span>
                      ) : (
                        <span className="cell-empty">—</span>
                      )}
                    </td>
                    <td>{r.invoiced > 0 ? r.invoiced : <span className="cell-empty">—</span>}</td>
                    <td>
                      {r.totalAmount > 0 ? (
                        <span className="amount-paid">₪{r.totalAmount.toLocaleString()}</span>
                      ) : (
                        <span className="cell-empty">—</span>
                      )}
                    </td>
                    <td>
                      {r.unpaidAmount > 0 ? (
                        <span className="amount-unpaid">₪{r.unpaidAmount.toLocaleString()}</span>
                      ) : (
                        <span className="cell-empty">—</span>
                      )}
                    </td>
                    <td>
                      <Link
                        href={`/patients/${r.id}?month=${month}`}
                        className="sessions-link"
                      >
                        פגישות
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
