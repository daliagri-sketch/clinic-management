'use client';

import { useState, useTransition } from 'react';
import type { MatchRow, SessionInfo } from '@/lib/matching';
import { saveSession, updateSession, issueInvoice } from '../actions';

type PatientOption = { id: string | number; name: string };

type Props = {
  rows: MatchRow[];
  patients: PatientOption[];
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type RowState = {
  selectedPatientId: string | number | null;
  saveState: SaveState;
  message: string | null;
  hidden: boolean;
  session: SessionInfo | null; // null = טרם נשמר לסשן
  sessionSaving: boolean;
  issuing: boolean;
  invoiceMsg: string | null;
};

const SESSION_STATUS_OPTIONS = [
  { value: 'scheduled', label: 'מתוכננת' },
  { value: 'occurred', label: 'התקיימה' },
  { value: 'cancelled', label: 'בוטלה' },
];

const PAID_OPTIONS = [
  { value: 'unpaid', label: 'לא שולם' },
  { value: 'paid', label: 'שולם' },
];

const PAYMENT_METHODS = [
  { value: 'cash', label: 'מזומן' },
  { value: 'transfer', label: 'העברה' },
  { value: 'bit', label: 'ביט' },
  { value: 'paybox', label: 'פייבוקס' },
];

export default function MatchingView({ rows, patients }: Props) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<Record<string, RowState>>(() => {
    const initial: Record<string, RowState> = {};
    for (const r of rows) {
      initial[r.eventId] = {
        selectedPatientId: r.patientId,
        saveState: r.session ? 'saved' : 'idle',
        message: null,
        hidden: false,
        session: r.session,
        sessionSaving: false,
        issuing: false,
        invoiceMsg: null,
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
        setRow(row.eventId, {
          saveState: 'saved',
          message: 'נשמר לסשן',
          session: res.session,
        });
      } else {
        setRow(row.eventId, { saveState: 'error', message: res.error });
      }
    });
  }

  // עדכון סטטוס פגישה / תשלום / אופן תשלום של סשן קיים
  function changeSession(eventId: string, patch: Partial<SessionInfo>) {
    const rs = state[eventId];
    if (!rs?.session) return;
    const next: SessionInfo = { ...rs.session, ...patch };
    if (next.paid !== 'paid') next.paymentMethod = null;

    setRow(eventId, { session: next, sessionSaving: true, invoiceMsg: null });

    startTransition(async () => {
      const res = await updateSession({
        sessionId: next.id,
        calendar_status: next.calendarStatus,
        paid: next.paid,
        payment_method: next.paymentMethod,
      });
      if (res.ok) {
        setRow(eventId, { session: res.session, sessionSaving: false });
      } else {
        setRow(eventId, { sessionSaving: false, invoiceMsg: res.error });
      }
    });
  }

  function handleIssue(eventId: string) {
    const rs = state[eventId];
    if (!rs?.session) return;
    const sessionId = rs.session.id;

    setRow(eventId, { issuing: true, invoiceMsg: null });

    startTransition(async () => {
      const res = await issueInvoice(sessionId);
      if (res.ok) {
        setRow(eventId, {
          issuing: false,
          session: { ...rs.session!, invoiceNumber: res.invoiceNumber },
          invoiceMsg: `הונפקה חשבונית ${res.invoiceNumber}`,
        });
      } else {
        setRow(eventId, { issuing: false, invoiceMsg: res.error });
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
            <th>סטטוס פגישה</th>
            <th>שולם</th>
            <th>אופן תשלום</th>
            <th>חשבונית</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rs = state[row.eventId];
            if (rs?.hidden) return null;
            const selectedId = rs?.selectedPatientId ?? null;
            const isMatched = selectedId != null;
            const autoMatched = row.patientId != null;
            const session = rs?.session ?? null;
            const isPaid = session?.paid === 'paid';
            const canIssue =
              !!session &&
              session.calendarStatus === 'occurred' &&
              session.paid === 'paid' &&
              !!row.patientIcountId &&
              !session.invoiceNumber &&
              !row.existingIcountInvoice;

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

                {/* סטטוס התאמה + שמירה */}
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
                          : session
                            ? '✓ נשמר'
                            : 'שמור לסשן'}
                      </button>
                    )}

                    {rs?.message && !session && (
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

                {/* סטטוס פגישה */}
                <td>
                  {session ? (
                    <select
                      className="patient-select"
                      value={session.calendarStatus}
                      disabled={rs?.sessionSaving}
                      onChange={(e) =>
                        changeSession(row.eventId, {
                          calendarStatus: e.target.value,
                        })
                      }
                    >
                      {SESSION_STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="cell-empty">—</span>
                  )}
                </td>

                {/* שולם */}
                <td>
                  {session ? (
                    <select
                      className="patient-select"
                      value={session.paid}
                      disabled={rs?.sessionSaving}
                      onChange={(e) =>
                        changeSession(row.eventId, { paid: e.target.value })
                      }
                    >
                      {PAID_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="cell-empty">—</span>
                  )}
                </td>

                {/* אופן תשלום — רק אם שולם */}
                <td>
                  {session && isPaid ? (
                    <select
                      className="patient-select"
                      value={session.paymentMethod ?? ''}
                      disabled={rs?.sessionSaving}
                      onChange={(e) =>
                        changeSession(row.eventId, {
                          paymentMethod: e.target.value || null,
                        })
                      }
                    >
                      <option value="">בחר…</option>
                      {PAYMENT_METHODS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="cell-empty">—</span>
                  )}
                </td>

                {/* חשבונית / הנפק */}
                <td>
                  {!session ? (
                    <span className="cell-empty">—</span>
                  ) : session.invoiceNumber ? (
                    <span className="matched">
                      חשבונית {session.invoiceNumber}
                    </span>
                  ) : row.existingIcountInvoice ? (
                    <span className="matched">
                      קיימת חשבונית {row.existingIcountInvoice}
                    </span>
                  ) : canIssue ? (
                    <button
                      type="button"
                      className="save-btn"
                      onClick={() => handleIssue(row.eventId)}
                      disabled={rs?.issuing}
                    >
                      {rs?.issuing ? 'מנפיק…' : 'הנפק'}
                    </button>
                  ) : (
                    <span className="cell-empty">—</span>
                  )}
                  {rs?.invoiceMsg && (
                    <span
                      className={
                        rs.invoiceMsg.startsWith('הונפקה')
                          ? 'msg-ok'
                          : 'msg-error'
                      }
                    >
                      {rs.invoiceMsg}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
