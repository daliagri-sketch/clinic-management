'use client';

import { useState, useTransition } from 'react';
import type { MatchRow } from '@/lib/matching';
import { saveSession } from '../actions';

type PatientOption = { id: string | number; name: string };

type Props = {
  rows: MatchRow[];
  patients: PatientOption[];
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type RowState = {
  // המטופל המשויך בפועל: ההתאמה האוטומטית, או בחירה ידנית מה-dropdown
  selectedPatientId: string | number | null;
  saveState: SaveState;
  message: string | null;
  hidden: boolean; // סומן "התעלם" — נעלם מהמסך, לא נכנס ל-sessions
};

export default function MatchingView({ rows, patients }: Props) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<Record<string, RowState>>(() => {
    const initial: Record<string, RowState> = {};
    for (const r of rows) {
      initial[r.eventId] = {
        selectedPatientId: r.patientId,
        saveState: 'idle',
        message: null,
        hidden: false,
      };
    }
    return initial;
  });

  function patientName(id: string | number | null): string {
    if (id == null) return '';
    const found = patients.find((p) => String(p.id) === String(id));
    return found?.name ?? '';
  }

  function setRow(eventId: string, patch: Partial<RowState>) {
    setState((prev) => ({ ...prev, [eventId]: { ...prev[eventId], ...patch } }));
  }

  function handleIgnore(eventId: string) {
    setRow(eventId, { hidden: true });
  }

  function handleSelect(eventId: string, value: string) {
    setRow(eventId, {
      selectedPatientId: value === '' ? null : value,
      saveState: 'idle',
      message: null,
    });
  }

  function handleSave(row: MatchRow) {
    const rs = state[row.eventId];
    if (rs?.selectedPatientId == null) return;

    setRow(row.eventId, { saveState: 'saving', message: null });

    startTransition(async () => {
      const res = await saveSession({
        eventId: row.eventId,
        patientId: rs.selectedPatientId!,
        date: row.date,
      });
      if (res.ok) {
        setRow(row.eventId, { saveState: 'saved', message: 'נשמר לסשן' });
      } else {
        setRow(row.eventId, { saveState: 'error', message: res.error });
      }
    });
  }

  return (
    <div className="table-wrap">
      <table className="patients-table matching-table">
        <thead>
          <tr>
            <th>מטופל</th>
            <th>תאריך</th>
            <th>שעה</th>
            <th>סטטוס התאמה</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rs = state[row.eventId];
            if (rs?.hidden) return null;
            const selectedId = rs?.selectedPatientId ?? null;
            const isMatched = selectedId != null;
            const autoMatched = row.patientId != null;

            return (
              <tr key={row.eventId}>
                {/* מטופל */}
                <td>
                  {isMatched ? (
                    <span className="matched" title={row.summary}>
                      {patientName(selectedId) || row.patientName}
                    </span>
                  ) : (
                    <span className="unmatched" title={row.summary}>
                      לא זוהה
                    </span>
                  )}
                  <span className="summary-hint">{row.summary}</span>
                </td>

                {/* תאריך */}
                <td>{row.date}</td>

                {/* שעה */}
                <td>{row.isAllDay ? 'כל היום' : row.time || '—'}</td>

                {/* סטטוס התאמה + פעולה */}
                <td>
                  <div className="status-cell">
                    {!autoMatched && (
                      <>
                        <select
                          className="patient-select"
                          value={selectedId == null ? '' : String(selectedId)}
                          onChange={(e) =>
                            handleSelect(row.eventId, e.target.value)
                          }
                        >
                          <option value="">בחר מטופל…</option>
                          {patients.map((p) => (
                            <option key={p.id} value={String(p.id)}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="ignore-btn"
                          onClick={() => handleIgnore(row.eventId)}
                        >
                          התעלם
                        </button>
                      </>
                    )}

                    {isMatched && (
                      <button
                        type="button"
                        className="save-btn"
                        onClick={() => handleSave(row)}
                        disabled={isPending && rs?.saveState === 'saving'}
                      >
                        {rs?.saveState === 'saving'
                          ? 'שומר…'
                          : rs?.saveState === 'saved'
                            ? '✓ נשמר'
                            : 'שמור לסשן'}
                      </button>
                    )}

                    {rs?.message && (
                      <span
                        className={
                          rs.saveState === 'error' ? 'msg-error' : 'msg-ok'
                        }
                      >
                        {rs.message}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
