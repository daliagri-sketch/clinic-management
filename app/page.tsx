import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';
import type { Patient } from '@/lib/types';
import PatientsView from './patients-view';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { data, error } = await supabaseServer
    .from('patients')
    .select('id, name, calendar_aliases, icount_id, default_rate, phone, email, active')
    .order('name', { ascending: true });

  if (error) {
    return (
      <main className="page">
        <h1>מטופלים</h1>
        <p className="error">שגיאה בטעינת המטופלים: {error.message}</p>
      </main>
    );
  }

  const patients = (data ?? []) as Patient[];

  return (
    <main className="page">
      <header className="page-header">
        <h1>מטופלים</h1>
        <span className="count">{patients.length} מטופלים</span>
        <Link href="/matching" className="nav-link">
          התאמה חודשית →
        </Link>
      </header>
      <PatientsView patients={patients} />
    </main>
  );
}
