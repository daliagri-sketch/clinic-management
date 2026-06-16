'use client';

import { useState, useTransition } from 'react';
import type { Patient, PatientUpdate } from '@/lib/types';
import { updatePatient } from './actions';

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
};

function toFormState(p: Patient): FormState {
  return {
    name: p.name ?? '',
    calendar_aliases: p.calendar_aliases ?? [],
    icount_id: p.icount_id ?? '',
    default_rate: p.default_rate != null ? String(p.default_rate) : '',
    phone: p.phone ?? '',
    email: p.email ?? '',
  };
}

export default function PatientsView({ patients }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function openPatient(p: Patient) {
    setSelectedId(p.id);
    setForm(toFormState(p));
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
    if (!selectedId || !form) return;
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
    };

    if (
      payload.default_rate !== null &&
      Number.isNaN(payload.default_rate)
    ) {
      setMessage('תעריף ברירת המחדל חייב להיות מספר');
      return;
    }

    startTransition(async () => {
      const res = await updatePatient(selectedId, payload);
      if (res.ok) {
        setMessage('נשמר בהצלחה');
      } else {
        setMessage(`שגיאה בשמירה: ${res.error}`);
      }
    });
  }

  return (
    <div className="layout">
      <div className="table-wrap">
        <table className="patients-table">
          <thead>
            <tr>
              <th>שם</th>
              <th>מזהה iCount</th>
              <th>תעריף ברירת מחדל</th>
              <th>טלפון</th>
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
              <h2>עריכת מטופל</h2>
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

            {message && <p className="message">{message}</p>}

            <div className="actions">
              <button
                type="button"
                className="primary-btn"
                onClick={handleSave}
                disabled={isPending}
              >
                {isPending ? 'שומר…' : 'שמירה'}
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
