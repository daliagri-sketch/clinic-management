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

export type ICountClientDetailed = {
  clientId: string;
  name: string;
  mobile: string;
};

// מביא לקוחות עם פרטים נוספים (נייד) — detail_level=10. משמש להתאמה
// אוטומטית במסך ההתאמה.
export async function fetchICountClientsDetailed(): Promise<
  ICountClientDetailed[]
> {
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
    body: JSON.stringify({ cid: ICOUNT_CID, detail_level: 10 }),
    cache: 'no-store',
  });

  const data = await res.json().catch(() => null);
  if (!data || data.status === false) {
    const reason =
      (data && (data.reason || data.error_description)) || 'שגיאה לא ידועה';
    throw new Error(`iCount: ${reason}`);
  }

  const clientsObj =
    data.clients && typeof data.clients === 'object'
      ? (data.clients as Record<string, Record<string, unknown>>)
      : {};

  return Object.values(clientsObj).map((c) => ({
    clientId: c.client_id == null ? '' : String(c.client_id).trim(),
    name: c.client_name == null ? '' : String(c.client_name).trim(),
    mobile: c.mobile == null ? '' : String(c.mobile).trim(),
  }));
}

export type ICountDoc = {
  doctype: string;
  docnum: string;
  dateissued: string;
  isCancelled: boolean;
};

// כל המסמכים של לקוח (doc/search). משמש לבדיקת חשבונית קיימת לפני הנפקה.
export async function fetchClientDocs(clientId: string): Promise<ICountDoc[]> {
  const token = process.env.ICOUNT_TOKEN;
  if (!token) {
    throw new Error('חסר משתנה הסביבה ICOUNT_TOKEN');
  }

  const res = await fetch(`${ICOUNT_BASE}/doc/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ cid: ICOUNT_CID, client_id: clientId }),
    cache: 'no-store',
  });

  const data = await res.json().catch(() => null);
  if (!data || data.status === false) {
    const reason =
      (data && (data.reason || data.error_description)) || 'שגיאה לא ידועה';
    throw new Error(`iCount: ${reason}`);
  }

  const list = Array.isArray(data.results_list) ? data.results_list : [];
  return list.map((d: Record<string, unknown>) => ({
    doctype: String(d.doctype ?? ''),
    docnum: String(d.docnum ?? ''),
    dateissued: String(d.dateissued ?? ''),
    isCancelled: d.is_cancelled === 1 || d.is_cancellation === 1,
  }));
}

// מספר חשבונית (מס/קבלה או מס) פעילה לאותו תאריך, אם קיימת.
export function findInvoiceOnDate(
  docs: ICountDoc[],
  date: string,
): string | null {
  const hit = docs.find(
    (d) =>
      d.dateissued === date &&
      !d.isCancelled &&
      (d.doctype === 'invrec' || d.doctype === 'invoice'),
  );
  return hit ? hit.docnum : null;
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

  const requestBody = buildInvoiceBody(params);

  const res = await fetch(ICOUNT_DOC_CREATE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(requestBody),
    cache: 'no-store',
  });

  // קוראים את הגוף כטקסט גולמי כדי שנוכל לרשום ללוג בדיוק מה iCount החזיר,
  // גם אם זו אינה תשובת JSON תקינה. ה-token אינו נרשם ללוג.
  const rawBody = await res.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
  } catch {
    data = null;
  }

  if (!res.ok || !data || data.status === false) {
    // לוג מפורט לאבחון create_doc_failed וכדומה — סטטוס HTTP + הגוף המלא + מה נשלח.
    console.error('[icount] doc/create נכשל', {
      httpStatus: res.status,
      httpStatusText: res.statusText,
      requestBody, // cid/client_id/sum/description — ללא סודות
      responseBody: data ?? rawBody, // אובייקט מפוענח, או טקסט גולמי אם הפענוח נכשל
    });

    const reason =
      (data && ((data.reason as string) || (data.error_description as string))) ||
      (rawBody && !data ? rawBody.slice(0, 500) : '') ||
      `HTTP ${res.status}` ||
      'שגיאה לא ידועה';
    throw new Error(`iCount: ${reason}`);
  }

  // בשלב זה data מובטח להיות אובייקט (נבדק למעלה) — שדות התוצאה מנורמלים בזהירות.
  const docInfo = (data.doc_info ?? null) as Record<string, unknown> | null;
  const num =
    data.docnum ??
    data.doc_number ??
    data.docnumber ??
    data.invoice_number ??
    (docInfo && (docInfo.docnum ?? docInfo.doc_number));

  if (num == null) {
    throw new Error('iCount: לא הוחזר מספר חשבונית');
  }
  return String(num);
}
