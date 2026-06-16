'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import type { PatientUpdate } from '@/lib/types';

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
