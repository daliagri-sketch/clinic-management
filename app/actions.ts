'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import type { PatientUpdate } from '@/lib/types';

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
