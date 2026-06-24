import 'server-only';

import { google } from 'googleapis';
import { supabaseServer } from './supabase-server';

/**
 * חיבור Google Calendar — שרת בלבד, קריאה בלבד.
 *
 * הסודות (client id/secret) נקראים אך ורק ממשתני סביבה.
 * ה-tokens נשמרים ב-Supabase (טבלת google_tokens) כך שהם זמינים גם
 * בסביבת serverless ללא מערכת קבצים מתמשכת (Vercel).
 */

// scope של קריאה בלבד ליומן
export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
];

// היומן שאליו מתחברים
export const CALENDAR_ACCOUNT = 'daliagri@gmail.com';

// מפתח השורה היחידה בטבלת google_tokens
const TOKEN_ROW_ID = 'default';

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

type StoredTokens = {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
};

export async function saveTokens(tokens: StoredTokens) {
  const { error } = await supabaseServer.from('google_tokens').upsert({
    id: TOKEN_ROW_ID,
    access_token: tokens.access_token ?? null,
    refresh_token: tokens.refresh_token ?? null,
    expiry_date: tokens.expiry_date ?? null,
  });

  if (error) {
    throw new Error(`שמירת ה-tokens ב-Supabase נכשלה: ${error.message}`);
  }
}

export async function loadTokens(): Promise<StoredTokens | null> {
  const { data, error } = await supabaseServer
    .from('google_tokens')
    .select('access_token, refresh_token, expiry_date')
    .eq('id', TOKEN_ROW_ID)
    .maybeSingle();

  if (error) {
    throw new Error(`טעינת ה-tokens מ-Supabase נכשלה: ${error.message}`);
  }

  if (!data || !data.access_token) {
    return null;
  }

  return data;
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
