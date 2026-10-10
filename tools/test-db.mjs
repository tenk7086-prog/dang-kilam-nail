// PostgreSQL nhúng, chạy offline sau npm install. Không chạm Supabase thật.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const db = new PGlite();
const root = new URL('../', import.meta.url);
try {
  // Chỉ mô phỏng phần Auth/roles do Supabase cung cấp sẵn.
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
  `);
  for (const file of [
    'supabase/migrations/202609300001_core.sql',
    'supabase/seed.sql',
    'supabase/migrations/202610010002_calendar_worker.sql',
    'supabase/migrations/202610090003_phone_lookup.sql',
    'supabase/migrations/202610090005_owner_future_booking.sql',
    'supabase/tests/01_core.sql',
    'supabase/tests/02_calendar.sql',
    'supabase/tests/03_phone_lookup.sql',
    'supabase/tests/04_owner_future_booking.sql'
  ]) {
    const results = await db.exec(await readFile(new URL(file, root), 'utf8'));
    if (file.includes('/tests/')) {
      const assertions = results.flatMap(r => r.rows ?? []).filter(r => r.label);
      const expected = file.includes('01_core') ? 72 : file.includes('02_calendar') ? 33 : file.includes('03_phone_lookup') ? 18 : 18;
      if (assertions.length !== expected) throw new Error(`Thiếu kết quả: ${assertions.length}/${expected}`);
      for (const row of assertions) console.log(`PASS: ${row.label}`);
      console.log(`\n${assertions.length}/${expected} kiểm tra đạt.`);
    }
    console.log(`OK: ${file}`);
  }
  console.log((await db.query('select version() as version')).rows[0].version);
  console.log('Chưa kiểm tra: Supabase HTTP/Auth thật, WebSocket Realtime, nhiều kết nối, Calendar, k6.');
} catch (error) {
  // Không in toàn bộ câu SQL hoặc cấu hình kết nối.
  console.error('FAIL:', error.message);
  if (error.code) console.error('SQLSTATE:', error.code);
  if (error.where) console.error('Vị trí:', error.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
