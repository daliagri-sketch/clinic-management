import 'server-only';

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

/**
 * חיבור Google Calendar — שרת בלבד, קריאה בלבד.
 *
 * הסודות (client id/secret) נקראים אך ורק ממשתני סביבה.
 * ה-tokens נשמרים מקומית בקובץ ולא ב-Supabase (בשלב זה).
 */

// scope של קריאה בלבד ליומן
export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
];

// היומן שאליו מתחברים
export const CALENDAR_ACCOUNT = 'daliagri@gmail.com';

// הקובץ המקומי שבו נשמרים ה-tokens (מחוץ ל-git)
export const TOKEN_PATH = path.join(process.cwd(), '.google-tokens.json');

export function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'חסרים משתני סביבה: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI',
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function saveTokens(tokens: unknown) {
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf-8');
}

export async function loadTokens() {
  try {
    const raw = await fs.readFile(TOKEN_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * OAuth2 client עם ה-tokens השמורים. אם ה-access token פג, ספריית google
 * מרעננת אותו אוטומטית בעזרת ה-refresh_token, ואנחנו שומרים את התוצאה חזרה.
 */
export async function getAuthorizedClient() {
  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error(
      'אין tokens שמורים — יש להתחבר תחילה דרך /api/auth/google',
    );
  }

  const oauth2 = getOAuth2Client();
  oauth2.setCredentials(tokens);

  oauth2.on('tokens', async (refreshed) => {
    // ב-refresh בדרך כלל לא מגיע refresh_token חדש — נשמר את הישן
    await saveTokens({ ...tokens, ...refreshed });
  });

  return oauth2;
}

export async function getCalendarClient() {
  const auth = await getAuthorizedClient();
  return google.calendar({ version: 'v3', auth });
}
