'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { fetchICountClients, createICountInvoice, type ICountClient } from '@/lib/icount';
import type { PatientUpdate } from '@/lib/types';
import type { SessionInfo } from '@/lib/matching';

const SESSION_STATUSES = ['scheduled', 'occurred', 'cancelled'];
const PAID_STATUSES = ['unpaid', 'paid'];
const PAYMENT_METHODS = ['cash', 'transfer', 'bit', 'paybox'];

function toSessionInfo(row: {
  id: number;
  calendar_status: string | null;
  paid: string | null;
  payment_method: string | null;
  invoice_number: string | null;
}): SessionInfo {
  return {
    id: row.id,
    calendarStatus: row.calendar_status ?? 'scheduled',
    paid: row.paid ?? 'unpaid',
    paymentMethod: row.payment_method,
    invoiceNumber: row.invoice_number,
  };
}

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

  // upsert על האילוץ הייחודי — מעדכן רק את עמודות המפתח, ולכן לא מאפס
  // calendar_status/paid אם השורה כבר קיימת. מחזיר את שורת הסשן המלאה.
  const { data, error } = await supabaseServer
    .from('sessions')
    .upsert(
      {
        event_id: input.eventId,
        date: input.date,
        patient_id: input.patientId,
      },
      { onConflict: 'event_id,date,patient_id' },
    )
    .select('id, calendar_status, paid, payment_method, invoice_number')
    .single();

  if (error || !data) {
    return { ok: false as const, error: error?.message ?? 'שמירת הסשן נכשלה' };
  }

  revalidatePath('/matching');
  return { ok: true as const, session: toSessionInfo(data) };
}

// עדכון סטטוס הפגישה / תשלום / אופן תשלום של סשן קיים.
export async function updateSession(input: {
  sessionId: number;
  calendar_status: string;
  paid: string;
  payment_method: string | null;
}) {
  if (!SESSION_STATUSES.includes(input.calendar_status)) {
    return { ok: false as const, error: 'סטטוס פגישה לא תקין' };
  }
  if (!PAID_STATUSES.includes(input.paid)) {
    return { ok: false as const, error: 'סטטוס תשלום לא תקין' };
  }

  // אופן תשלום רלוונטי רק כאשר שולם; אחרת מתאפס.
  const paymentMethod =
    input.paid === 'paid' &&
    input.payment_method &&
    PAYMENT_METHODS.includes(input.payment_method)
      ? input.payment_method
      : null;

  const { data, error } = await supabaseServer
    .from('sessions')
    .update({
      calendar_status: input.calendar_status,
      paid: input.paid,
      payment_method: paymentMethod,
    })
    .eq('id', input.sessionId)
    .select('id, calendar_status, paid, payment_method, invoice_number')
    .single();

  if (error || !data) {
    return { ok: false as const, error: error?.message ?? 'עדכון הסשן נכשל' };
  }

  revalidatePath('/matching');
  return { ok: true as const, session: toSessionInfo(data) };
}

// הנפקת חשבונית ב-iCount עבור סשן. נקראת רק בלחיצה ידנית על "הנפק".
// תנאים (נבדקים גם בשרת): occurred + paid + למטופל יש icount_id + אין invoice_number.
export async function issueInvoice(sessionId: number) {
  const { data: session, error: sErr } = await supabaseServer
    .from('sessions')
    .select('id, calendar_status, paid, invoice_number, amount, patient_id')
    .eq('id', sessionId)
    .single();

  if (sErr || !session) {
    return { ok: false as const, error: sErr?.message ?? 'הסשן לא נמצא' };
  }
  if (session.calendar_status !== 'occurred' || session.paid !== 'paid') {
    return { ok: false as const, error: 'תנאי ההנפקה אינם מתקיימים (נדרש occurred + paid)' };
  }
  if (session.invoice_number) {
    return { ok: false as const, error: 'כבר הונפקה חשבונית לסשן זה' };
  }

  const { data: patient, error: pErr } = await supabaseServer
    .from('patients')
    .select('name, icount_id, default_rate')
    .eq('id', session.patient_id)
    .single();

  if (pErr || !patient) {
    return { ok: false as const, error: pErr?.message ?? 'המטופל לא נמצא' };
  }
  if (!patient.icount_id) {
    return { ok: false as const, error: 'למטופל אין icount_id' };
  }

  const sum = patient.default_rate;
  if (sum == null) {
    return { ok: false as const, error: 'למטופל אין default_rate לחשבונית' };
  }

  let invoiceNumber: string;
  try {
    invoiceNumber = await createICountInvoice({
      clientId: String(patient.icount_id),
      sum: Number(sum),
      description: 'טיפול',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'שגיאה לא ידועה';
    return { ok: false as const, error: message };
  }

  const { error: uErr } = await supabaseServer
    .from('sessions')
    .update({ invoice_number: invoiceNumber })
    .eq('id', sessionId);

  if (uErr) {
    return {
      ok: false as const,
      error: `החשבונית הונפקה (${invoiceNumber}) אך שמירת המספר נכשלה: ${uErr.message}`,
    };
  }

  revalidatePath('/matching');
  return { ok: true as const, invoiceNumber };
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
