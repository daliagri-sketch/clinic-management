-- עדכון מזהי iCount לפי שמות המטופלים
-- הרץ ב-Supabase Dashboard → SQL Editor

update patients set icount_id = '1692' where name ilike '%בר%' and name ilike '%וסול%';
update patients set icount_id = '1714' where name ilike '%יפעת%' and name ilike '%בראלי%';
update patients set icount_id = '1709' where name ilike '%רחל%' and name ilike '%אלמליח%';
update patients set icount_id = '380'  where name ilike '%קרן%' and name ilike '%אוחיון%';
update patients set icount_id = '1667' where name ilike '%תומר%' and name ilike '%יונה%';
update patients set icount_id = '1656' where name ilike '%עמית%' and name ilike '%יוסף%';
update patients set icount_id = '1495' where name ilike '%כפיר%' and name ilike '%כהן%';

-- תיקון אליאסים בעייתיים שגרמו להתאמה שגויה:
-- "אדווה יוריש" — הסרת alias קצר "אדווה" שגרם לו לתפוס "אדווה וכפיר שמקה"
-- עדכן ל-alias מלא בלבד: {"אדווה יוריש"}
update patients
  set calendar_aliases = array['אדווה יוריש']
  where name ilike '%אדווה%' and name ilike '%יוריש%';

-- "דוד תורגמן" — בדיקה: אם יש לו alias שתפס "עידן ומיטל רז", עדכן ל-alias מדויק
-- (תבדקי ידנית מה ה-alias הנוכחי שלו לפני הרצה)
-- update patients set calendar_aliases = array['דוד תורגמן'] where name ilike '%דוד%' and name ilike '%תורגמן%';

-- מחיקת הסשן השגוי: עידן ומיטל רז שהוכנס כדוד תורגמן (אם קיים)
-- לאחר שתזהי את session_id הנכון ב-Supabase → sessions table, הרץ:
-- delete from sessions where id = <session_id>;
