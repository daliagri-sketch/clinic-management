'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { Patient, PatientUpdate } from '@/lib/types';
import { updatePatient, createPatient, syncFromICount } from './actions';

type MissingClient = { icountId: string; name: string };

const EMPTY_FORM: FormState = {
  name: '',
  calendar_aliases: [],
  icount_id: '',
  default_rate: '',
  phone: '',
  email: '',
  active: true,
};

type Props = {
  patients: Patient[];
};

type FormState = {
  name: string;
  calendar_aliases: string[];
  icount_id: string;
  default_rate: string;
  phone: string;
  email: string;
  active: boolean;
};

function toFormState(p: Patient): FormState {
  return {
    name: p.name ?? '',
    calendar_aliases: p.calendar_aliases ?? [],
    icount_id: p.icount_id ?? '',
    default_rate: p.default_rate != null ? String(p.default_rate) : '',
    phone: p.phone ?? '',
    email: p.email ?? '',
    active: p.active ?? true,
  };
}

export default function PatientsView({ patients }: Props) {
  const [mode, setMode] = useState<'edit' | 'add'>('edit');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  // סנכרון מ-iCount
  const [showSync, setShowSync] = useState(false);
  const [syncState, setSyncState] = useState<
    'idle' | 'loading' | 'done' | 'error'
  >('idle');
  const [syncMissing, setSyncMissing] = useState<MissingClient[]>([]);
  const [syncTotal, setSyncTotal] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  function handleSync() {
    setShowSync(true);
    setSyncState('loading');
    setSyncError(null);
    startTransition(async () => {
      const res = await syncFromICount();
      if (res.ok) {
        setSyncMissing(res.missing);
        setSyncTotal(res.icountTotal);
        setSyncState('done');
      } else {
        setSyncError(res.error);
        setSyncState('error');
      }
    });
  }

  function openPatient(p: Patient) {
    setMode('edit');
    setSelectedId(p.id);
    setForm(toFormState(p));
    setMessage(null);
  }

  function openAdd(prefill?: { name?: string; icount_id?: string }) {
    setMode('add');
    setSelectedId(null);
    setForm({
      ...EMPTY_FORM,
      calendar_aliases: [],
      name: prefill?.name ?? '',
      icount_id: prefill?.icount_id ?? '',
    });
    setMessage(null);
  }

  function closePanel() {
    setSelectedId(null);
    setForm(null);
    setMessage(null);
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function updateAlias(index: number, value: string) {
    setForm((prev) => {
      if (!prev) return prev;
      const next = [...prev.calendar_aliases];
      next[index] = value;
      return { ...prev, calendar_aliases: next };
    });
  }

  function addAlias() {
    setForm((prev) =>
      prev ? { ...prev, calendar_aliases: [...prev.calendar_aliases, ''] } : prev,
    );
  }

  function removeAlias(index: number) {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            calendar_aliases: prev.calendar_aliases.filter((_, i) => i !== index),
          }
        : prev,
    );
  }

  function handleSave() {
    if (!form) return;
    if (mode === 'edit' && !selectedId) return;
    setMessage(null);

    const rateTrimmed = form.default_rate.trim();
    const payload: PatientUpdate = {
      name: form.name.trim(),
      calendar_aliases: form.calendar_aliases
        .map((a) => a.trim())
        .filter((a) => a.length > 0),
      icount_id: form.icount_id.trim(),
      default_rate: rateTrimmed === '' ? null : Number(rateTrimmed),
      phone: form.phone.trim(),
      email: form.email.trim(),
      active: form.active,
    };

    if (mode === 'add' && payload.name === '') {
      setMessage('שם הוא שדה חובה');
      return;
    }

    if (payload.default_rate !== null && Number.isNaN(payload.default_rate)) {
      setMessage('תעריף ברירת המחדל חייב להיות מספר');
      return;
    }

    startTransition(async () => {
      const res =
        mode === 'add'
          ? await createPatient(payload)
          : await updatePatient(selectedId!, payload);

      if (res.ok) {
        if (mode === 'add') {
          closePanel(); // השורה החדשה תופיע בטבלה לאחר הרענון
        } else {
          setMessage('נשמר בהצלחה');
        }
      } else {
        setMessage(`שגיאה בשמירה: ${res.error}`);
      }
    });
  }

  return (
    <div className="layout">
      <div className="toolbar">
        <button type="button" className="primary-btn" onClick={() => openAdd()}>
          + הוסף מטופל
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={handleSync}
          disabled={isPending && syncState === 'loading'}
        >
          {syncState === 'loading' ? 'מסנכרן…' : 'סנכרן מ-iCount'}
        </button>
      </div>

      {showSync && (
        <div className="sync-panel">
          <div className="sync-header">
            <strong>סנכרון מ-iCount</strong>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setShowSync(false)}
              aria-label="סגירה"
            >
              ✕
            </button>
          </div>

          {syncState === 'loading' && <p className="muted">טוען מ-iCount…</p>}

          {syncState === 'error' && (
            <p className="msg-error">שגיאה: {syncError}</p>
          )}

          {syncState === 'done' &&
            (syncMissing.length === 0 ? (
              <p className="muted">
                כל הלקוחות מ-iCount כבר קיימים באפליקציה ({syncTotal} נבדקו).
              </p>
            ) : (
              <>
                <p className="muted">
                  {syncMissing.length} לקוחות ב-iCount שאינם באפליקציה (מתוך{' '}
                  {syncTotal}):
                </p>
                <ul className="sync-list">
                  {syncMissing.map((c) => (
                    <li key={c.icountId} className="sync-row">
                      <span className="sync-name">{c.name || '(ללא שם)'}</span>
                      <span className="sync-id">iCount: {c.icountId}</span>
                      <button
                        type="button"
                        className="add-btn"
                        onClick={() =>
                          openAdd({ name: c.name, icount_id: c.icountId })
                        }
                      >
                        הוסף לאפליקציה
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ))}
        </div>
      )}

      <div className="table-wrap">
        <table className="patients-table">
          <thead>
            <tr>
              <th>שם</th>
              <th>מזהה iCount</th>
              <th>תעריף ברירת מחדל</th>
              <th>טלפון</th>
              <th>סטטוס</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {patients.map((p) => (
              <tr
                key={p.id}
                onClick={() => openPatient(p)}
                className={p.id === selectedId ? 'selected' : ''}
              >
                <td>{p.name ?? '—'}</td>
                <td>{p.icount_id ?? '—'}</td>
                <td>{p.default_rate ?? '—'}</td>
                <td>{p.phone ?? '—'}</td>
                <td>
                  {p.active === false ? (
                    <span className="inactive-chip">לא פעיל</span>
                  ) : null}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <Link
                    href={`/patients/${p.id}`}
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

      {form && (
        <>
          <div className="overlay" onClick={closePanel} />
          <aside className="side-card">
            <div className="side-card-header">
              <h2>{mode === 'add' ? 'הוספת מטופל' : 'עריכת מטופל'}</h2>
              <button
                type="button"
                className="icon-btn"
                onClick={closePanel}
                aria-label="סגירה"
              >
                ✕
              </button>
            </div>

            <div className="field">
              <label>שם</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
              />
            </div>

            <div className="field">
              <label>כינויים ביומן</label>
              <div className="alias-list">
                {form.calendar_aliases.length === 0 && (
                  <p className="muted">אין כינויים</p>
                )}
                {form.calendar_aliases.map((alias, i) => (
                  <div className="alias-row" key={i}>
                    <input
                      type="text"
                      value={alias}
                      onChange={(e) => updateAlias(i, e.target.value)}
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => removeAlias(i)}
                      aria-label="הסרת כינוי"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button type="button" className="add-btn" onClick={addAlias}>
                  + הוספת כינוי
                </button>
              </div>
            </div>

            <div className="field">
              <label>מזהה iCount</label>
              <input
                type="text"
                value={form.icount_id}
                onChange={(e) => setField('icount_id', e.target.value)}
              />
            </div>

            <div className="field">
              <label>תעריף ברירת מחדל</label>
              <input
                type="number"
                value={form.default_rate}
                onChange={(e) => setField('default_rate', e.target.value)}
              />
            </div>

            <div className="field">
              <label>טלפון</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
              />
            </div>

            <div className="field">
              <label>אימייל</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setField('email', e.target.value)}
              />
            </div>

            <div className="field">
              <label>סטטוס</label>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setField('active', e.target.checked)}
                />
                <span>{form.active ? 'פעיל' : 'לא פעיל'}</span>
              </label>
            </div>

            {message && <p className="message">{message}</p>}

            <div className="actions">
              <button
                type="button"
                className="primary-btn"
                onClick={handleSave}
                disabled={isPending}
              >
                {mode === 'add'
                  ? isPending
                    ? 'מוסיף…'
                    : 'הוספה'
                  : isPending
                    ? 'שומר…'
                    : 'שמירה'}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={closePanel}
                disabled={isPending}
              >
                ביטול
              </button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
