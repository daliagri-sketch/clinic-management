'use client';

import { useState, useTransition } from 'react';
import { saveSession, updateSession, issueInvoice } from '@/app/actions';

export type SessionInfo = {
  id: number;
  calendarStatus: string;
  paid: string;
  paymentMethod: string | null;
  invoiceNumber: string | null;
};

export type SessionRow = {
  eventId: string;
  summary: string;
  date: string;
  time: string;
  isAllDay: boolean;
  session: SessionInfo | null;
  existingIcountInvoice: string | null;
};

type Props = {
  rows: SessionRow[];
  patientId: string;
  patientIcountId: string | null;
  month: string;
};

type RowState = {
  session: SessionInfo | null;
  saving: boolean;
  sessionSaving: boolean;
  issuing: boolean;
  message: string | null;
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

export default function PatientSessionsView({
  rows,
  patientId,
  patientIcountId,
  month,
}: Props) {
  const [, startTransition] = useTransition();

  const [state, setState] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {};
    for (const r of rows) {
      init[r.eventId] = {
        session: r.session,
        saving: false,
        sessionSaving: false,
        issuing: false,
        message: null,
      };
    }
    return init;
  });

  function setRow(eventId: string, patch: Partial<RowState>) {
    setState((prev) => ({
      ...prev,
      [eventId]: { ...prev[eventId], ...patch },
    }));
  }

  function handleSave(row: SessionRow) {
    setRow(row.eventId, { saving: true, message: null });
    startTransition(async () => {
      const res = await saveSession({
        eventId: row.eventId,
        patientId,
        date: row.date,
      });
      if (res.ok) {
        setRow(row.eventId, { saving: false, session: res.session, message: 'נשמר' });
      } else {
        setRow(row.eventId, { saving: false, message: res.error });
      }
    });
  }

  function handleSessionChange(eventId: string, patch: Partial<SessionInfo>) {
    const rs = state[eventId];
    if (!rs?.session) return;
    const next: SessionInfo = { ...rs.session, ...patch };
    if (next.paid !== 'paid') next.paymentMethod = null;

    setRow(eventId, { session: next, sessionSaving: true, message: null });
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
        setRow(eventId, { sessionSaving: false, message: res.error });
      }
    });
  }

  function handleIssue(eventId: string) {
    const rs = state[eventId];
    if (!rs?.session) return;
    const sessionId = rs.session.id;
    setRow(eventId, { issuing: true, message: null });
    startTransition(async () => {
      const res = await issueInvoice(sessionId);
      if (res.ok) {
        setRow(eventId, {
          issuing: false,
          session: { ...rs.session!, invoiceNumber: res.invoiceNumber },
          message: `חשבונית ${res.invoiceNumber}`,
        });
      } else {
        setRow(eventId, { issuing: false, message: res.error });
      }
    });
  }

  if (rows.length === 0) {
    return (
      <p className="muted" style={{ padding: '24px 0' }}>
        לא נמצאו פגישות ביומן לחודש זה עבור מטופל זה.
      </p>
    );
  }

  return (
    <div className="table-wrap">
      <table className="patients-table matching-table">
        <thead>
          <tr>
            <th>תאריך</th>
            <th>שעה</th>
            <th>תיאור ביומן</th>
            <th>סטטוס פגישה</th>
            <th>שולם</th>
            <th>אופן תשלום</th>
            <th>חשבונית</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rs = state[row.eventId];
            const session = rs?.session ?? null;
            const isPaid = session?.paid === 'paid';
            const canIssue =
              !!session &&
              session.calendarStatus === 'occurred' &&
              session.paid === 'paid' &&
              !!patientIcountId &&
              !session.invoiceNumber &&
              !row.existingIcountInvoice;

            return (
              <tr key={row.eventId}>
                {/* תאריך */}
                <td>{row.date}</td>

                {/* שעה */}
                <td>{row.isAllDay ? 'כל היום' : row.time || '—'}</td>

                {/* תיאור */}
                <td className="summary-cell">{row.summary}</td>

                {/* סטטוס פגישה / שמירה */}
                <td>
                  {session ? (
                    <select
                      className="patient-select"
                      value={session.calendarStatus}
                      disabled={rs?.sessionSaving}
                      onChange={(e) =>
                        handleSessionChange(row.eventId, {
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
                    <div className="status-cell">
                      <button
                        type="button"
                        className="save-btn"
                        onClick={() => handleSave(row)}
                        disabled={rs?.saving}
                      >
                        {rs?.saving ? 'שומר…' : 'שמור'}
                      </button>
                      {rs?.message && (
                        <span className="msg-error">{rs.message}</span>
                      )}
                    </div>
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
                        handleSessionChange(row.eventId, { paid: e.target.value })
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

                {/* אופן תשלום */}
                <td>
                  {session && isPaid ? (
                    <select
                      className="patient-select"
                      value={session.paymentMethod ?? ''}
                      disabled={rs?.sessionSaving}
                      onChange={(e) =>
                        handleSessionChange(row.eventId, {
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

                {/* חשבונית */}
                <td>
                  {!session ? (
                    <span className="cell-empty">—</span>
                  ) : session.invoiceNumber ? (
                    <span className="matched">חשבונית {session.invoiceNumber}</span>
                  ) : row.existingIcountInvoice ? (
                    <span className="matched">
                      קיימת {row.existingIcountInvoice}
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
                  {rs?.message && session && (
                    <span
                      className={
                        rs.message.startsWith('חשבונית') ? 'msg-ok' : 'msg-error'
                      }
                    >
                      {rs.message}
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
