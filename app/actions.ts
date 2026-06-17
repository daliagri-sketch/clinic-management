'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { fetchICountClients, type ICountClient } from '@/lib/icount';
import type { PatientUpdate } from '@/lib/types';

// סנכרון מ-iCount: שולף לקוחות מ-iCount, משווה לפי icount_id מול patients,
// ומחזיר את הלקוחות שקיימים ב-iCount אך לא באפליקציה. לא מוסיף אוטומטית.
export async function syncFromICount(): Promise<
  | { ok: true; missing: ICountClient[]; icountTotal: number }
  | { ok: false; error: string }
> {
  let clients: ICountClient[];
  try {
    clients = await fetchICountClients();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'שגיאה לא ידועה';
    return { ok: false, error: message };
  }

  const { data, error } = await supabaseServer
    .from('patients')
    .select('icount_id, name');

  if (error) {
    return { ok: false, error: `שגיאה בטעינת המטופלים: ${error.message}` };
  }

  const normalizeName = (v: unknown) =>
    v == null ? '' : String(v).trim().replace(/\s+/g, ' ');

  const existingIds = new Set(
    (data ?? [])
      .map((p) => (p.icount_id == null ? '' : String(p.icount_id).trim()))
      .filter((v) => v.length > 0),
  );
  const existingNames = new Set(
    (data ?? []).map((p) => normalizeName(p.name)).filter((v) => v.length > 0),
  );

  // לקוח "קיים" אם ה-client_id שלו ידוע, או ששמו תואם לשם מטופל קיים.
  const missing = clients.filter(
    (c) => !existingIds.has(c.icountId) && !existingNames.has(normalizeName(c.name)),
  );

  return { ok: true, missing, icountTotal: clients.length };
}

export type SaveSessionInput = {
  eventId: string;
  patientId: number | string;
  date: string;
};

// כתיבה ל-sessions — מופעלת רק בלחיצה ידנית על "שמור לסשן".
// upsert על האילוץ הייחודי (event_id, date, patient_id) כדי שלחיצה חוזרת
// לא תיצור כפילות.
export async function saveSession(input: SaveSessionInput) {
  if (!input.eventId || input.patientId == null || !input.date) {
    return { ok: false as const, error: 'חסרים פרטים לשמירת הסשן' };
  }

  const { error } = await supabaseServer
    .from('sessions')
    .upsert(
      {
        event_id: input.eventId,
        date: input.date,
        patient_id: input.patientId,
      },
      { onConflict: 'event_id,date,patient_id', ignoreDuplicates: true },
    );

  if (error) {
    return { ok: false as const, error: error.message };
  }

  return { ok: true as const };
}

export async function createPatient(data: PatientUpdate) {
  const { error } = await supabaseServer.from('patients').insert({
    name: data.name,
    calendar_aliases: data.calendar_aliases,
    icount_id: data.icount_id,
    default_rate: data.default_rate,
    phone: data.phone,
    email: data.email,
  });

  if (error) {
    return { ok: false as const, error: error.message };
  }

  revalidatePath('/');
  return { ok: true as const };
}

export async function updatePatient(id: string, data: PatientUpdate) {
  const { error } = await supabaseServer
    .from('patients')
    .update({
      name: data.name,
      calendar_aliases: data.calendar_aliases,
      icount_id: data.icount_id,
      default_rate: data.default_rate,
      phone: data.phone,
      email: data.email,
    })
    .eq('id', id);

  if (error) {
    return { ok: false as const, error: error.message };
  }

  revalidatePath('/');
  return { ok: true as const };
}
