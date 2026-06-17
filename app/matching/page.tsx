import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';
import type { Patient } from '@/lib/types';
import { fetchMonthEvents } from '@/lib/calendar';
import { buildMatchRows } from '@/lib/matching';
import MatchingView from './matching-view';

export const dynamic = 'force-dynamic';

const DEFAULT_MONTH = '2026-05';

export default async function MatchingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const month =
    sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : DEFAULT_MONTH;

  // מטופלים (צד שרת)
  const { data: patientsData, error: patientsError } = await supabaseServer
    .from('patients')
    .select('id, name, calendar_aliases')
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

  const matchedCount = rows.filter((r) => r.patientId != null).length;
  const unmatchedCount = rows.length - matchedCount;

  const patientOptions = patients.map((p) => ({
    id: p.id,
    name: p.name ?? '',
  }));

  return (
    <main className="page">
      <header className="page-header">
        <h1>התאמה חודשית</h1>
        <span className="count">
          {month} · {rows.length} אירועים · {matchedCount} מזוהים ·{' '}
          {unmatchedCount} לא זוהו
        </span>
        <Link href="/" className="nav-link">
          ← מטופלים
        </Link>
      </header>
      <MatchingView rows={rows} patients={patientOptions} />
    </main>
  );
}
