import { NextResponse } from 'next/server';
import {
  getOAuth2Client,
  GOOGLE_CALENDAR_SCOPES,
  CALENDAR_ACCOUNT,
} from '@/lib/google';

export const dynamic = 'force-dynamic';

// GET /api/auth/google — מתחיל את זרימת ה-OAuth ומפנה ל-Google
export async function GET() {
  const oauth2 = getOAuth2Client();

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline', // כדי לקבל refresh_token
    prompt: 'consent', // מבטיח refresh_token גם בחיבור חוזר
    scope: GOOGLE_CALENDAR_SCOPES,
    login_hint: CALENDAR_ACCOUNT,
  });

  return NextResponse.redirect(authUrl);
}
