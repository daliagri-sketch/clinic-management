import 'server-only';

/**
 * חיבור ל-iCount — שרת בלבד, קריאה בלבד.
 *
 * אימות: כותרת `Authorization: Bearer <ICOUNT_TOKEN>` (אומת מול ה-API).
 * הטוקן נקרא אך ורק ממשתנה הסביבה ICOUNT_TOKEN.
 */

const ICOUNT_BASE = 'https://api.icount.co.il/api/v3.php';
export const ICOUNT_CID = 'daliagri';

export type ICountClient = {
  icountId: string; // מזהה הלקוח ב-iCount — מושווה מול patients.icount_id
  name: string;
};

// נירמול אוסף הלקוחות מהתשובה: iCount עשוי להחזיר אובייקט ממופתח-לפי-id
// או מערך, ותחת מפתחות שונים. ננסה את הצורות הסבירות בזהירות.
function normalizeClients(data: unknown): ICountClient[] {
  if (!data || typeof data !== 'object') return [];
  const obj = data as Record<string, unknown>;

  const collection =
    (obj.clients as unknown) ??
    (obj.client_list as unknown) ??
    (obj.data as unknown) ??
    (obj.rows as unknown);

  let entries: Array<[string, unknown]> = [];
  if (Array.isArray(collection)) {
    entries = collection.map((c, i) => [String(i), c]);
  } else if (collection && typeof collection === 'object') {
    entries = Object.entries(collection as Record<string, unknown>);
  } else {
    return [];
  }

  const result: ICountClient[] = [];
  for (const [key, raw] of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    const idVal = c.client_id ?? c.id ?? c.cid ?? key;
    const nameVal = c.client_name ?? c.name ?? c.contact_name ?? '';
    const icountId = idVal != null ? String(idVal).trim() : '';
    if (!icountId) continue;
    result.push({ icountId, name: String(nameVal).trim() });
  }
  return result;
}

export async function fetchICountClients(): Promise<ICountClient[]> {
  const token = process.env.ICOUNT_TOKEN;
  if (!token) {
    throw new Error('חסר משתנה הסביבה ICOUNT_TOKEN');
  }

  const res = await fetch(`${ICOUNT_BASE}/client/get_list`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ cid: ICOUNT_CID }),
    cache: 'no-store',
  });

  const data = await res.json().catch(() => null);

  if (!data || data.status === false) {
    const reason =
      (data && (data.reason || data.error_description)) || 'שגיאה לא ידועה';
    throw new Error(`iCount: ${reason}`);
  }

  return normalizeClients(data);
}

export const ICOUNT_DOC_CREATE_URL = `${ICOUNT_BASE}/doc/create`;

export type InvoiceParams = {
  clientId: string;
  sum: number;
  description: string;
};

// גוף הבקשה ל-doc/create — מוגדר במקום אחד כדי שהתצוגה-מקדימה תהיה זהה למה שנשלח.
export function buildInvoiceBody(params: InvoiceParams) {
  return {
    cid: ICOUNT_CID,
    doctype: 'invrec', // חשבונית מס קבלה
    client_id: params.clientId,
    sum: params.sum,
    description: params.description,
  };
}

// הנפקת חשבונית מס קבלה ב-iCount (doc/create). פעולה פיננסית אמיתית — נקראת רק
// מ-issueInvoice לאחר אימות התנאים. שמות שדה התוצאה מנורמלים בזהירות.
export async function createICountInvoice(params: InvoiceParams): Promise<string> {
  const token = process.env.ICOUNT_TOKEN;
  if (!token) {
    throw new Error('חסר משתנה הסביבה ICOUNT_TOKEN');
  }

  const res = await fetch(ICOUNT_DOC_CREATE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(buildInvoiceBody(params)),
    cache: 'no-store',
  });

  const data = await res.json().catch(() => null);
  if (!data || data.status === false) {
    const reason =
      (data && (data.reason || data.error_description)) || 'שגיאה לא ידועה';
    throw new Error(`iCount: ${reason}`);
  }

  const num =
    data.docnum ??
    data.doc_number ??
    data.docnumber ??
    data.invoice_number ??
    (data.doc_info && (data.doc_info.docnum ?? data.doc_info.doc_number));

  if (num == null) {
    throw new Error('iCount: לא הוחזר מספר חשבונית');
  }
  return String(num);
}
