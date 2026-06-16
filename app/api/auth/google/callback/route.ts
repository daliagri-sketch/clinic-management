import { NextRequest, NextResponse } from 'next/server';
import { getOAuth2Client, saveTokens, TOKEN_PATH } from '@/lib/google';

export const dynamic = 'force-dynamic';

// GET /api/auth/google/callback — מקבל את ה-code מ-Google ושומר את ה-tokens מקומית
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const oauthError = params.get('error');
  if (oauthError) {
    return NextResponse.json(
      { ok: false, error: oauthError },
      { status: 400 },
    );
  }

  const code = params.get('code');
  if (!code) {
    return NextResponse.json(
      { ok: false, error: 'חסר פרמטר code בתשובה מ-Google' },
      { status: 400 },
    );
  }

  const oauth2 = getOAuth2Client();

  try {
    const { tokens } = await oauth2.getToken(code);
    await saveTokens(tokens);

    return NextResponse.json({
      ok: true,
      message: 'החיבור ל-Google Calendar הצליח. ה-tokens נשמרו מקומית.',
      tokenFile: TOKEN_PATH,
      scope: tokens.scope,
      hasRefreshToken: Boolean(tokens.refresh_token),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'שגיאה לא ידועה';
    return NextResponse.json(
      { ok: false, error: `החלפת ה-code ב-tokens נכשלה: ${message}` },
      { status: 500 },
    );
  }
}
