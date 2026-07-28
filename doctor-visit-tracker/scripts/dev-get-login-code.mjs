#!/usr/bin/env node
/**
 * Print a login code without sending an email.
 *
 * DEVELOPMENT AND TESTING ONLY. Never part of the shipped app.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two Supabase free-tier limits meet in a way that stops testing dead:
 *
 *   1. The stock email templates send a confirmation LINK, not a numeric
 *      code. A phone app cannot use a link.
 *   2. Editing those templates requires custom SMTP, and custom SMTP on a
 *      company domain requires the IT department.
 *
 * So: the app is correct, the email arrives, login is impossible, and the fix
 * is behind somebody else's ticket queue.
 *
 * Supabase's admin API can be asked for the one-time code directly. This
 * script asks, and prints it. No email is sent, so the two-per-hour limit
 * does not apply and there is nothing to be caught by a spam filter.
 *
 * The app is not modified in any way. It still does a normal email OTP login;
 * the code is simply obtained by hand instead of by email.
 *
 * ABOUT THE KEY THIS ASKS FOR
 * ---------------------------
 * The service_role key bypasses every security rule in this project. It is
 * therefore:
 *
 *   * asked for at the prompt, never read from a file and never written to
 *     one — so it cannot end up in git, in OneDrive, or in .env;
 *   * not echoed as you paste it;
 *   * not accepted as a command-line argument, which would put it in the
 *     shell history.
 *
 * Do not paste it anywhere else. If it ever leaks, rotate it immediately in
 * Supabase → Settings → API.
 *
 * USAGE
 *   npm run dev:code
 */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, '..');

// -----------------------------------------------------------------------------
// The part worth testing, kept free of prompts and process exits.
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

/**
 * Which role does this key carry?
 *
 * Pasting the anon key here is the obvious mistake — both are long strings
 * starting `eyJ`, sitting next to each other on the same dashboard page. The
 * anon key produces a bare 401 from the admin endpoint, which reads as "the
 * script is broken" rather than "wrong key". Say which key was given instead.
 */
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

/**
 * Ask Supabase for a login code for this address.
 *
 * Uses the admin generate_link endpoint, which returns the one-time code in
 * its response. Returns { code, actionLink }.
 */
export async function requestLoginCode({ supabaseUrl, serviceKey, email, fetchImpl = fetch }) {
  const base = supabaseUrl.replace(/\/+$/, '');
  const response = await fetchImpl(`${base}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ type: 'magiclink', email }),
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Supabase returned something that is not JSON (HTTP ${response.status}):\n${text}`);
  }

  if (!response.ok) {
    const detail = body?.msg ?? body?.message ?? body?.error_description ?? text;
    throw new Error(`Supabase refused the request (HTTP ${response.status}): ${detail}`);
  }

  // The field sits at the top level on current GoTrue and under `properties`
  // on older releases. Accept both rather than break on a server upgrade.
  const code = body.email_otp ?? body.properties?.email_otp ?? null;
  const actionLink = body.action_link ?? body.properties?.action_link ?? null;

  if (!code) {
    throw new Error(
      'Supabase accepted the request but returned no code. Response was:\n' +
        JSON.stringify(body, null, 2),
    );
  }

  return { code, actionLink };
}

// -----------------------------------------------------------------------------
// The interactive wrapper.
// -----------------------------------------------------------------------------

/**
 * One readline interface for the whole run, not one per question.
 *
 * Opening a second interface hangs: the first buffers everything already
 * available on stdin and then closes, so the second is handed a stream with
 * nothing left in it, its callback never fires, the event loop empties and
 * node exits 0 having printed nothing. Silently, and with a success code.
 */
function makePrompter() {
  // `terminal` must match what stdin actually is. Forcing it true on a pipe
  // makes readline echo everything the moment it arrives — which printed the
  // service_role key in full, directly under the prompt promising it would not
  // be shown.
  const isTty = Boolean(process.stdin.isTTY);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: isTty });

  // Lines are buffered rather than read with rl.question().
  //
  // rl.question() only captures a line if it is already waiting when the line
  // arrives. Down a pipe every line arrives at once, so the first question
  // takes the first line, the rest are emitted with nobody listening and are
  // dropped, the stream ends, the second question never fires, and node exits
  // 0 having printed nothing. Silently, with a success code.
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

    // Swallow the echo so the key does not stay on screen — or in a
    // screenshot, or in a scrollback buffer somebody else reads. Only
    // meaningful on a terminal; a pipe echoes nothing to begin with.
    const mask = silent && isTty;
    if (mask) rl._writeToOutput = () => {};

    const line = await nextLine();

    if (mask) {
      rl._writeToOutput = (chunk) => rl.output.write(chunk);
      process.stdout.write('\n');
    } else if (!isTty) {
      process.stdout.write('\n');
    }

    return (line ?? '').trim();
  };

  return { ask, close: () => rl.close() };
}

async function main() {
  const { ask, close } = makePrompter();
  console.log('');
  console.log('  Нэвтрэх код авах (и-мэйл илгээхгүй)');
  console.log('  ─────────────────────────────────────');
  console.log('');

  // DVT_ENV_FILE exists so the end-to-end test can point this at a fixture
  // instead of overwriting the real .env. Nothing else sets it.
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

  const email = await ask('  И-мэйл хаяг: ');
  if (!email) {
    close();
    console.error('  ❌ И-мэйл хаяг оруулаагүй байна.');
    process.exit(1);
  }

  console.log('');
  console.log('  service_role түлхүүрээ буулгана уу.');
  console.log('  Supabase → Settings → API → Project API keys → service_role → Copy');
  console.log('  (Бичихэд дэлгэц дээр харагдахгүй. Хаана ч хадгалагдахгүй.)');
  console.log('');
  const serviceKey = await ask('  service_role key: ', { silent: true });

  if (!serviceKey) {
    close();
    console.error('  ❌ Түлхүүр оруулаагүй байна.');
    process.exit(1);
  }

  close();

  const role = roleOfKey(serviceKey);
  if (role === 'anon') {
    console.error('');
    console.error('  ❌ Энэ бол anon түлхүүр, service_role биш.');
    console.error('     Хоёулаа eyJ… гэж эхэлдэг тул андуурахад амархан.');
    console.error('     Supabase → Settings → API дээр "service_role" гэсэн мөрийг хуулна уу.');
    process.exit(1);
  }
  if (role !== 'service_role') {
    console.error('');
    console.error(`  ❌ Энэ түлхүүр танигдахгүй байна (role: ${role ?? 'тодорхойгүй'}).`);
    process.exit(1);
  }

  console.log('');
  console.log('  Хүсэлт илгээж байна…');

  let result;
  try {
    result = await requestLoginCode({ supabaseUrl, serviceKey, email });
  } catch (error) {
    console.error('');
    console.error(`  ❌ ${error.message}`);
    console.error('');
    console.error('  Түгээмэл шалтгаанууд:');
    console.error('   · "User not found" — энэ хаягаар нэг ч удаа нэвтрэхийг оролдоогүй байна.');
    console.error('     Аппаас нэг удаа "Код авах" дараад дахин оролдоно уу.');
    console.error('   · Интернэт эсвэл прокси хаасан.');
    process.exit(1);
  }

  console.log('');
  console.log('  ┌──────────────────────────┐');
  console.log(`  │   ${result.code.padEnd(22)} │`);
  console.log('  └──────────────────────────┘');
  console.log('');
  console.log('  Энэ кодыг аппын нэвтрэх дэлгэц дээр оруулна уу.');
  console.log('  И-мэйл ИЛГЭЭГДЭЭГҮЙ — цагийн хязгаар зарцуулагдаагүй.');
  console.log('');
}

// Only run when invoked directly, so the exported functions can be tested.
if (process.argv[1] && process.argv[1].endsWith('dev-get-login-code.mjs')) {
  main();
}
