# SPEC — ניהול קליניקה

מסמך זה מתאר את המערכת כפי שנבנתה עד כה. עברית, RTL.

## סקירה

אפליקציית Next.js (App Router, TypeScript) לניהול קליניקה. מקור הנתונים הוא
Supabase, והחיבורים החיצוניים (Supabase service-role, Google Calendar) הם
**צד-שרת בלבד**.

## חיבורים ומשתני סביבה

כל הסודות נקראים אך ורק מ-`.env.local` (לא נכתבים בקוד, לא נכנסים ל-git):

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (`http://localhost:3000/api/auth/google/callback`)

- `lib/supabase-server.ts` — client של Supabase, מסומן `import 'server-only'`.
- `lib/google.ts` — OAuth2 client ל-Google Calendar, `import 'server-only'`.
  ה-tokens נשמרים מקומית ב-`.google-tokens.json` (לא ב-Supabase, לא ב-git).

## מטופלים (`patients`)

- שליפת כל הרשומות בצד-שרת.
- מסך טבלה: `name`, `icount_id`, `default_rate`, `phone`.
- לחיצה על שורה פותחת כרטיס צד לעריכת: `name`, `calendar_aliases` (מערך
  ערכים), `icount_id`, `default_rate`, `phone`, `email`.
- שמירה דרך Server Action (`updatePatient`) שמעדכנת את Supabase.

## Google Calendar (קריאה בלבד)

- OAuth 2.0 מול חשבון `daliagri@gmail.com`, scope `calendar.readonly`.
- `GET /api/auth/google` — מתחיל את זרימת ה-OAuth ומפנה ל-Google.
- `GET /api/auth/google/callback` — מקבל את ה-code ושומר tokens מקומית.
- `GET /api/calendar/events?month=YYYY-MM` — מושך אירועי חודש כ-JSON גולמי
  (שלב אימות נתונים בלבד; אין כתיבה, אין התאמה למטופלים).

## פגישות (`sessions`)

טבלת `sessions` מקשרת אירוע יומן למטופל בתאריך נתון.

### אילוץ ייחודיות

**`UNIQUE (event_id, date, patient_id)`** (שם: `sessions_event_id_date_patient_id_key`).

קודם לכן האילוץ היה `UNIQUE (event_id, date)`, אך הוא נחסם פגישות זוגיות:
אירוע יומן אחד באותו תאריך יכול לכלול יותר ממטופל אחד (למשל "שרון ואור").
הוספת `patient_id` לאילוץ מאפשרת כמה מטופלים לאותו `event_id`+`date`, תוך
שמירה על מניעת כפילות של אותו מטופל באותה פגישה.

## גבולות

- אין מסכים נוספים מעבר למסך המטופלים.
- אין משיכת/כתיבת אירועים אל מעבר לנתיב האימות.
- אין אינטגרציה ל-Gmail או ל-iCount בשלב זה.
