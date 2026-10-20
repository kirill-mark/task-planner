// Actual PostgreSQL execution in a temporary PGlite database; no Supabase calls.
// Install the test runtime separately, then set MARK_PGLITE_MODULE to its module.
import fs from "node:fs/promises";
import assert from "node:assert/strict";

const { PGlite } = await import(process.env.MARK_PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const root = new URL("../", import.meta.url);
const a = "00000000-0000-0000-0000-000000000001";
const b = "00000000-0000-0000-0000-000000000002";
const when = "2026-10-09T09:00:00Z";
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`PASS ${name}`); };
const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0].value;
const purge = (snapshot, expectedUser = a) => scalar("select public.mark_empty_trash($1::jsonb, $2::uuid) as value", [JSON.stringify(snapshot), expectedUser]);
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    insert into auth.users values ('${a}'), ('${b}');
  `);
  await db.exec(await fs.readFile(new URL("supabase/migrations/0001_mark_core_model.sql", root), "utf8"));
  await db.exec("create table public.mark_account_mode(user_id uuid primary key, mode text, epoch integer, changed_at timestamptz, note text)");
  // The exact locking and mode functions from existing migrations.
  for (const [file, name] of [["0004_mark_change_cursor.sql", "mark_lock_user"], ["0005_mark_cutover.sql", "mark_mode"]]) {
    const sql = await fs.readFile(new URL(`supabase/migrations/${file}`, root), "utf8");
    const start = sql.indexOf(`create or replace function ${name}(`);
    const end = sql.indexOf("$$;", start) + 3;
    await db.exec(sql.slice(start, end));
  }
  await db.exec(`
    insert into public.mark_account_mode values ('${a}', 'v2', 1, now(), null), ('${b}', 'v2', 7, now(), null);
    create table public.cfo_test(user_id uuid, amount integer);
    insert into public.cfo_test values ('${a}', 123);
    insert into public.mark_groups(user_id,id,name) values ('${a}', 'group', 'Group');
    insert into public.mark_tasks(user_id,id,title,group_id,deleted_at) values
      ('${a}', 'shared', 'Own trash', 'group', '${when}'),
      ('${b}', 'shared', 'Other trash', null, '${when}'),
      ('${b}', 'other-only', 'Other only', null, '${when}'),
      ('${a}', 'active', 'Active', 'group', null),
      ('${a}', 'restored', 'Restored', null, null),
      ('${a}', 'changed', 'Deleted again', null, '2026-10-09T10:00:00Z'),
      ('${a}', 'unlisted', 'Not in snapshot', null, '${when}');
  `);
  await db.exec(await fs.readFile(new URL("supabase/migrations/0014_mark_empty_trash.sql", root), "utf8"));
  const before = await scalar("select count(*)::int as value from public.mark_tasks");
  check("applying migration removes no rows", () => assert.equal(before, 7));
  await assert.rejects(() => purge([{ id: "shared", deleted_at: when }]), /authentication required/);
  checks++; console.log("PASS authentication required");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [a]);
  await assert.rejects(() => purge([], b), /account changed/);
  checks++; console.log("PASS mismatched account identity is refused");
  await db.exec("set role anon");
  await assert.rejects(() => purge([]), /permission denied/);
  await db.exec("reset role; set role authenticated");
  checks++; console.log("PASS anonymous role cannot execute");
  const result = await purge(["shared", "other-only", "active", "restored", "changed"].map((id) => ({ id, deleted_at: when })));
  check("authenticated user deletes only matching own trash snapshot", () => assert.equal(result.tasks, 1));
  await db.exec("reset role");
  const remaining = await scalar("select count(*)::int as value from public.mark_tasks");
  check("active, restored, changed, unlisted and other-user tasks remain", () => assert.equal(remaining, 6));
  const epochs = (await db.query("select epoch from public.mark_account_mode order by user_id")).rows.map((r) => r.epoch);
  check("only owner's full-state epoch changes", () => assert.deepEqual(epochs, [2, 7]));
  const other = await scalar("select count(*)::int as value from public.mark_tasks where user_id=$1", [b]);
  check("other user's two tasks remain", () => assert.equal(other, 2));
  const group = await scalar("select count(*)::int as value from public.mark_groups");
  const finance = await scalar("select amount as value from public.cfo_test");
  check("groups and financial data remain", () => { assert.equal(group, 1); assert.equal(finance, 123); });
  const repeated = await purge([{ id: "shared", deleted_at: when }]);
  const epoch = await scalar("select epoch as value from public.mark_account_mode where user_id=$1", [a]);
  check("repeat is harmless and does not invalidate state again", () => { assert.equal(repeated.tasks, 0); assert.equal(epoch, 2); });
  await db.exec(`
    create function public.test_epoch_failure() returns trigger language plpgsql as $$ begin raise exception 'controlled epoch failure'; end; $$;
    create trigger test_epoch_failure before update of epoch on public.mark_account_mode for each row execute function public.test_epoch_failure();
  `);
  await assert.rejects(() => purge([{ id: "unlisted", deleted_at: when }]), /controlled epoch failure/);
  const rolledBack = await scalar("select count(*)::int as value from public.mark_tasks where user_id=$1 and id='unlisted'", [a]);
  check("failure after DELETE rolls back all deletion", () => assert.equal(rolledBack, 1));
  // Live schema audit found mark_mode now defaults to v2 for accounts with
  // no explicit mode record. Purging must create their epoch atomically too.
  await db.exec(`
    drop trigger test_epoch_failure on public.mark_account_mode;
    create or replace function public.mark_mode(p_user uuid) returns text language sql stable security definer set search_path=public as $$
      select coalesce((select mode from mark_account_mode where user_id=p_user), 'v2'); $$;
    insert into auth.users values ('00000000-0000-0000-0000-000000000003');
    insert into public.mark_tasks(user_id,id,title,deleted_at) values ('00000000-0000-0000-0000-000000000003','fresh','Fresh','${when}');
  `);
  const freshUser = "00000000-0000-0000-0000-000000000003";
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [freshUser]);
  const fresh = await purge([{ id: "fresh", deleted_at: when }], freshUser);
  const freshEpoch = await scalar("select epoch as value from public.mark_account_mode where user_id=$1", [freshUser]);
  check("v2 account without a mode record gets its epoch", () => { assert.equal(fresh.tasks, 1); assert.equal(freshEpoch, 2); });
  console.log(`${checks}/${checks} PostgreSQL checks passed`);
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
} finally { await db.close(); }
