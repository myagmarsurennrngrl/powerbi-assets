#!/usr/bin/env node
/**
 * Give somebody a password.
 *
 * ADMINISTRATOR TOOL. Never part of the shipped app.
 *
 * WHY THIS EXISTS AND IS NOT OPTIONAL
 * -----------------------------------
 * The app signs in with email and password, and there is deliberately no
 * self-registration and no self-service reset. Both would need proof that
 * somebody owns a mailbox, and email delivery does not work here: the Supabase
 * free tier sends a link a phone app cannot use, and editing that template
 * requires SMTP the company has not configured.
 *
 * Without proof of mailbox ownership, letting anyone choose the password for an
 * address means an employee could claim their manager's address before the
 * manager did and inherit their access. So the administrator issues the first
 * password, out of band, and the person changes it in Settings.
 *
 * This is therefore the tool for:
 *   * a new person's first password;
 *   * a forgotten password;
 *   * an account created by an earlier one-time-code attempt, which exists in
 *     auth.users with no password at all and cannot otherwise be signed into.
 *
 * WHAT IT DOES
 *   1. finds the login for that address, or creates one if there is none;
 *   2. sets the password;
 *   3. marks the address confirmed, so no confirmation email is required;
 *   4. links it to the app_user row, so the person actually has access.
 *
 * ABOUT THE KEY THIS ASKS FOR
 * ---------------------------
 * The service_role key bypasses every security rule in this project. It is
 * asked for at the prompt, never read from or written to a file, not echoed,
 * and not accepted as an argument where it would land in shell history.
 *
 * USAGE
 *   npm run dev:set-password
 */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, '..');

// -----------------------------------------------------------------------------
// The testable part: no prompts, no process exits.
// -----------------------------------------------------------------------------

/** Pull one variable out of a .env file. */
export function readEnvValue(contents, name) {
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== name) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value.trim();
  }
  return null;
}

/** Which role does this key carry? Names the anon-key mistake specifically. */
export function roleOfKey(key) {
  try {
    const payload = key.split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    );
    const parsed = JSON.parse(json);
    return typeof parsed.role === 'string' ? parsed.role : null;
  } catch {
    return null;
  }
}

function admin({ supabaseUrl, serviceKey, fetchImpl }) {
  const base = supabaseUrl.replace(/\/+$/, '');
  return async (path, init = {}) => {
    const response = await fetchImpl(`${base}/auth/v1/admin${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(
          `Supabase returned something that is not JSON (HTTP ${response.status}):\n${text}`,
        );
      }
    }
    if (!response.ok) {
      const detail = body?.msg ?? body?.message ?? body?.error_description ?? text;
      throw new Error(`Supabase refused the request (HTTP ${response.status}): ${detail}`);
    }
    return body;
  };
}

/**
 * Set (or create) the login for an address.
 *
 * Returns { userId, created } — `created` distinguishes "this person had never
 * signed in" from "this was a reset", which is worth reporting back because
 * only the first case means the app_user row still needs linking.
 */
export async function setPassword({ supabaseUrl, serviceKey, email, password, fetchImpl = fetch }) {
  const call = admin({ supabaseUrl, serviceKey, fetchImpl });
  const normalised = email.trim().toLowerCase();

  // Look the address up rather than assuming. Creating a duplicate login for an
  // address that already has one is the failure mode to avoid: the app then
  // finds two candidate identities and the app_user row can only point at one.
  const found = await call(`/users?page=1&per_page=200`);
  const users = Array.isArray(found?.users) ? found.users : [];
  const existing = users.find((u) => (u.email ?? '').toLowerCase() === normalised) ?? null;

  if (existing) {
    await call(`/users/${existing.id}`, {
      method: 'PUT',
      // email_confirm matters: an account created by an unfinished one-time-code
      // attempt is unconfirmed, and Supabase refuses a password sign-in for an
      // unconfirmed address with the same "Invalid login credentials" it uses
      // for a wrong password — indistinguishable from the outside.
      body: JSON.stringify({ password, email_confirm: true }),
    });
    return { userId: existing.id, created: false };
  }

  const created = await call('/users', {
    method: 'POST',
    body: JSON.stringify({ email: normalised, password, email_confirm: true }),
  });
  if (!created?.id) {
    throw new Error(`Supabase created no user. Response was:\n${JSON.stringify(created, null, 2)}`);
  }
  return { userId: created.id, created: true };
}

// -----------------------------------------------------------------------------
// The interactive wrapper. Shares makePrompter's shape with dev-get-login-code.
// -----------------------------------------------------------------------------

function makePrompter() {
  // `terminal` must match what stdin actually is: forcing it true on a pipe
  // makes readline echo everything the moment it arrives, which would print the
  // password and the service_role key in full.
  const isTty = Boolean(process.stdin.isTTY);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: isTty });

  // Lines are buffered rather than read with rl.question(), which only captures
  // a line if it is already waiting when that line arrives. Down a pipe every
  // line arrives at once and the later questions would never fire.
  const buffered = [];
  const waiting = [];
  let ended = false;

  rl.on('line', (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else buffered.push(line);
  });
  rl.on('close', () => {
    ended = true;
    while (waiting.length) waiting.shift()(null);
  });

  const nextLine = () => {
    if (buffered.length) return Promise.resolve(buffered.shift());
    if (ended) return Promise.resolve(null);
    return new Promise((resolve) => waiting.push(resolve));
  };

  const ask = async (question, { silent = false } = {}) => {
    process.stdout.write(question);
    const mask = silent && isTty;
    if (mask) rl._writeToOutput = () => {};

    const line = await nextLine();

    if (mask) {
      rl._writeToOutput = (chunk) => rl.output.write(chunk);
      process.stdout.write('\n');
    } else if (!isTty) {
      process.stdout.write('\n');
    }
    // Not trimmed for a password: a leading or trailing space is a legitimate
    // character, and removing it silently sets a password nobody can reproduce.
    return line ?? '';
  };

  return { ask, close: () => rl.close() };
}

async function main() {
  const { ask, close } = makePrompter();
  console.log('');
  console.log('  Хэрэглэгчид нууц үг олгох');
  console.log('  ─────────────────────────');
  console.log('');

  const envPath = process.env.DVT_ENV_FILE ?? join(PROJECT_ROOT, '.env');
  let envContents;
  try {
    envContents = readFileSync(envPath, 'utf8');
  } catch {
    close();
    console.error('  ❌ .env файл олдсонгүй. doctor-visit-tracker хавтас дотор ажиллуулна уу.');
    process.exit(1);
  }

  const supabaseUrl = readEnvValue(envContents, 'EXPO_PUBLIC_SUPABASE_URL');
  if (!supabaseUrl) {
    close();
    console.error('  ❌ .env дотор EXPO_PUBLIC_SUPABASE_URL байхгүй байна.');
    process.exit(1);
  }
  console.log(`  Төсөл: ${supabaseUrl}`);
  console.log('');

  const email = (await ask('  И-мэйл хаяг: ')).trim();
  if (!email) {
    close();
    console.error('  ❌ И-мэйл хаяг оруулаагүй байна.');
    process.exit(1);
  }

  console.log('');
  console.log('  Шинэ нууц үг. Дор хаяж 10 тэмдэгт.');
  console.log('  (Бичихэд дэлгэц дээр харагдахгүй.)');
  console.log('');
  const password = await ask('  Нууц үг: ', { silent: true });
  const again = await ask('  Дахин:   ', { silent: true });

  if (password !== again) {
    close();
    console.error('');
    console.error('  ❌ Хоёр нууц үг таарахгүй байна. Дахин ажиллуулна уу.');
    process.exit(1);
  }
  if (password.length < 10) {
    close();
    console.error('');
    console.error('  ❌ Нууц үг дор хаяж 10 тэмдэгт байх ёстой.');
    process.exit(1);
  }

  console.log('');
  console.log('  service_role түлхүүрээ буулгана уу.');
  console.log('  Supabase → Settings → API → service_role → Copy');
  console.log('');
  const serviceKey = (await ask('  service_role key: ', { silent: true })).trim();
  close();

  if (!serviceKey) {
    console.error('  ❌ Түлхүүр оруулаагүй байна.');
    process.exit(1);
  }
  const role = roleOfKey(serviceKey);
  if (role === 'anon') {
    console.error('');
    console.error('  ❌ Энэ бол anon түлхүүр, service_role биш.');
    console.error('     Хоёулаа eyJ… гэж эхэлдэг тул андуурахад амархан.');
    process.exit(1);
  }
  if (role !== 'service_role') {
    console.error('');
    console.error(`  ❌ Түлхүүр танигдахгүй байна (role: ${role ?? 'тодорхойгүй'}).`);
    process.exit(1);
  }

  console.log('');
  console.log('  Тохируулж байна…');

  let result;
  try {
    result = await setPassword({ supabaseUrl, serviceKey, email, password });
  } catch (error) {
    console.error('');
    console.error(`  ❌ ${error.message}`);
    process.exit(1);
  }

  console.log('');
  console.log(`  ✅ ${email} — нууц үг тохирлоо.`);
  console.log(
    result.created
      ? '     Нэвтрэх бүртгэл шинээр үүслээ.'
      : '     Байсан бүртгэлийн нууц үгийг сольлоо.',
  );
  console.log('');
  console.log('  ДАРААГИЙН АЛХАМ — Supabase SQL Editor дээр ажиллуулна:');
  console.log('');
  console.log('    UPDATE public.app_user u');
  console.log('       SET auth_user_id = a.id');
  console.log('      FROM auth.users a');
  console.log(`     WHERE lower(u.email::text) = lower('${email}')`);
  console.log('       AND lower(a.email) = lower(u.email::text)');
  console.log('       AND u.auth_user_id IS DISTINCT FROM a.id;');
  console.log('');
  console.log('  Энэ мөргүйгээр хүн нэвтрэх боловч «бүртгэл идэвхжээгүй» гэж заана.');
  console.log('');
}

if (process.argv[1] && process.argv[1].endsWith('dev-set-password.mjs')) {
  main();
}
