import 'server-only';

import { supabaseServer } from './supabase-server';
import { fetchICountClientsDetailed } from './icount';
import { cleanSummary } from './matching';
import type { MatchRow } from './matching';
import type { Patient } from './types';

const norm = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ');

/**
 * עבור אירועים שלא הותאמו לאף מטופל: חיפוש אוטומטי ב-iCount לפי שם האירוע.
 * התאמה ברורה אחת (client_name יחיד ששווה בדיוק לשם האירוע, גולמי או מנוקה)
 * → הוספת המטופל ל-patients (שם, icount_id, טלפון, calendar_alias מהאירוע)
 * וסימון השורה כמזוהה. אחרת — נשאר "לא זוהה".
 */
export async function autoMatchFromICount(
  rows: MatchRow[],
  patients: Patient[],
): Promise<{ rows: MatchRow[]; addedPatients: Patient[]; added: string[] }> {
  const unmatched = rows.filter((r) => r.patientId == null && r.summary.trim());
  if (unmatched.length === 0) {
    return { rows, addedPatients: [], added: [] };
  }

  let clients;
  try {
    clients = await fetchICountClientsDetailed();
  } catch {
    // iCount לא זמין — משאירים את השורות כפי שהן
    return { rows, addedPatients: [], added: [] };
  }

  // שם מנורמל -> רשימת לקוחות עם אותו שם (כדי לזהות עמימות)
  const byName = new Map<string, typeof clients>();
  for (const c of clients) {
    const k = norm(c.name);
    if (!k) continue;
    const list = byName.get(k) ?? [];
    list.push(c);
    byName.set(k, list);
  }

  const existingByIcountId = new Map<string, Patient>();
  for (const p of patients) {
    const v = p.icount_id == null ? '' : String(p.icount_id).trim();
    if (v) existingByIcountId.set(v, p);
  }

  function clearMatch(summary: string) {
    const raw = norm(summary);
    const rawHit = byName.get(raw);
    if (rawHit && rawHit.length === 1) return rawHit[0];
    const cleaned = norm(cleanSummary(summary));
    if (cleaned && cleaned !== raw) {
      const cHit = byName.get(cleaned);
      if (cHit && cHit.length === 1) return cHit[0];
    }
    return null;
  }

  // מועמדים: שורה -> לקוח iCount בהתאמה ברורה
  const candByEvent = new Map<
    string,
    { clientId: string; clientName: string; mobile: string; alias: string }
  >();
  for (const r of unmatched) {
    const c = clearMatch(r.summary);
    if (!c || !c.clientId) continue;
    candByEvent.set(r.eventId, {
      clientId: c.clientId,
      clientName: c.name,
      mobile: c.mobile,
      alias: r.summary.trim(),
    });
  }
  if (candByEvent.size === 0) {
    return { rows, addedPatients: [], added: [] };
  }

  // dedupe להוספה לפי clientId, רק עבור לקוחות שאינם כבר מטופלים
  const toInsert = new Map<
    string,
    { clientName: string; mobile: string; alias: string }
  >();
  for (const cand of candByEvent.values()) {
    if (existingByIcountId.has(cand.clientId)) continue;
    if (!toInsert.has(cand.clientId)) {
      toInsert.set(cand.clientId, {
        clientName: cand.clientName,
        mobile: cand.mobile,
        alias: cand.alias,
      });
    }
  }

  const insertedByClientId = new Map<string, Patient>();
  const added: string[] = [];

  if (toInsert.size > 0) {
    const payload = [...toInsert.entries()].map(([clientId, c]) => ({
      name: c.clientName,
      icount_id: clientId,
      phone: c.mobile || null,
      calendar_aliases: [c.alias],
    }));

    const { data, error } = await supabaseServer
      .from('patients')
      .insert(payload)
      .select('id, name, calendar_aliases, icount_id, default_rate, phone, email');

    if (!error && data) {
      for (const p of data as Patient[]) {
        const key = p.icount_id == null ? '' : String(p.icount_id).trim();
        if (key) insertedByClientId.set(key, p);
        added.push(`${p.name ?? ''} (iCount ${key})`);
      }
    }
  }

  function patientForClient(clientId: string): Patient | undefined {
    return existingByIcountId.get(clientId) ?? insertedByClientId.get(clientId);
  }

  const enriched = rows.map((r) => {
    const cand = candByEvent.get(r.eventId);
    if (!cand) return r;
    const p = patientForClient(cand.clientId);
    if (!p) return r; // ההוספה נכשלה — נשאר לא זוהה
    return {
      ...r,
      patientId: p.id,
      patientName: p.name ?? cand.clientName,
      patientIcountId: cand.clientId,
    };
  });

  return {
    rows: enriched,
    addedPatients: [...insertedByClientId.values()],
    added,
  };
}
