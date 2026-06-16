import 'server-only';

import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client — שרת בלבד.
 *
 * הקובץ מסומן ב-`import 'server-only'`, כך שכל ניסיון לייבא אותו מתוך
 * Client Component יכשל ב-build. מפתח ה-service role נקרא אך ורק ממשתנה
 * הסביבה ולעולם לא נכתב בקוד.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('חסר משתנה הסביבה NEXT_PUBLIC_SUPABASE_URL');
}

if (!serviceRoleKey) {
  throw new Error('חסר משתנה הסביבה SUPABASE_SERVICE_ROLE_KEY');
}

export const supabaseServer = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
