/**
 * The development-only "get me a login code" helper.
 *
 * It exists because two free-tier limits meet badly: the stock email template
 * sends a link rather than a code, and editing that template requires custom
 * SMTP. Testing stops until somebody's IT department answers a ticket.
 *
 * It is a script rather than app code, but it handles the service_role key and
 * it is the only way into the app right now, so it is tested like anything
 * else. Everything here runs against a stub fetch — no network, no real key.
 */
import { describe, expect, it, vi } from 'vitest';
import { readEnvValue, roleOfKey, requestLoginCode } from '../../scripts/dev-get-login-code.mjs';

/** Builds a JWT-shaped string carrying the given role. Not signed; nothing verifies it. */
function keyWithRole(role: string): string {
  const part = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${part({ alg: 'HS256' })}.${part({ role, iss: 'supabase' })}.c2lnbmF0dXJl`;
}

const SERVICE_KEY = keyWithRole('service_role');
const ANON_KEY = keyWithRole('anon');

describe('reading the project URL out of .env', () => {
  it('finds the value', () => {
    const env = 'EXPO_PUBLIC_SUPABASE_URL=https://abc.supabase.co\nOTHER=1\n';
    expect(readEnvValue(env, 'EXPO_PUBLIC_SUPABASE_URL')).toBe('https://abc.supabase.co');
  });

  it('ignores comments and blank lines', () => {
    const env = '\n# EXPO_PUBLIC_SUPABASE_URL=https://wrong.supabase.co\nEXPO_PUBLIC_SUPABASE_URL=https://right.supabase.co\n';
    expect(readEnvValue(env, 'EXPO_PUBLIC_SUPABASE_URL')).toBe('https://right.supabase.co');
  });

  it('strips quotes and Windows line endings', () => {
    const env = 'EXPO_PUBLIC_SUPABASE_URL="https://abc.supabase.co"\r\n';
    expect(readEnvValue(env, 'EXPO_PUBLIC_SUPABASE_URL')).toBe('https://abc.supabase.co');
  });

  it('does not match a variable whose name merely contains the one asked for', () => {
    const env = 'MY_EXPO_PUBLIC_SUPABASE_URL=https://wrong.supabase.co\n';
    expect(readEnvValue(env, 'EXPO_PUBLIC_SUPABASE_URL')).toBeNull();
  });

  it('returns null when absent', () => {
    expect(readEnvValue('FOO=1\n', 'EXPO_PUBLIC_SUPABASE_URL')).toBeNull();
  });
});

describe('telling the two keys apart', () => {
  // Both start eyJ and sit next to each other on the same dashboard page.
  // Pasting the anon key gives a bare 401, which reads as a broken script.
  it('recognises the service_role key', () => {
    expect(roleOfKey(SERVICE_KEY)).toBe('service_role');
  });

  it('recognises the anon key, so the mistake can be named', () => {
    expect(roleOfKey(ANON_KEY)).toBe('anon');
  });

  it('returns null for something that is not a JWT at all', () => {
    expect(roleOfKey('not-a-key')).toBeNull();
    expect(roleOfKey('')).toBeNull();
  });
});

describe('asking Supabase for the code', () => {
  const call = (fetchImpl: typeof fetch) =>
    requestLoginCode({
      supabaseUrl: 'https://abc.supabase.co',
      serviceKey: SERVICE_KEY,
      email: 'rep01@monos.mn',
      fetchImpl,
    });

  const ok = (body: unknown) =>
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    });

  /** vi.fn() is not shaped like fetch; the script only ever calls it. */
  const asFetch = (stub: ReturnType<typeof ok>) => stub as unknown as typeof fetch;

  it('posts to the admin endpoint with the key in both places GoTrue wants it', async () => {
    const fetchImpl = ok({ email_otp: '483920', action_link: 'https://abc/verify' });
    await call(asFetch(fetchImpl));

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://abc.supabase.co/auth/v1/admin/generate_link');
    expect(init.method).toBe('POST');
    expect(init.headers.apikey).toBe(SERVICE_KEY);
    expect(init.headers.Authorization).toBe(`Bearer ${SERVICE_KEY}`);
    expect(JSON.parse(init.body)).toEqual({ type: 'magiclink', email: 'rep01@monos.mn' });
  });

  it('returns the code', async () => {
    const result = await call(asFetch(ok({ email_otp: '483920' })));
    expect(result.code).toBe('483920');
  });

  it('reads the code from `properties` too, where older GoTrue puts it', async () => {
    const result = await call(asFetch(ok({ properties: { email_otp: '112233' } })));
    expect(result.code).toBe('112233');
  });

  it('does not double the slash when the URL has a trailing one', async () => {
    const fetchImpl = ok({ email_otp: '1' });
    await requestLoginCode({
      supabaseUrl: 'https://abc.supabase.co/',
      serviceKey: SERVICE_KEY,
      email: 'a@monos.mn',
      fetchImpl: asFetch(fetchImpl),
    });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://abc.supabase.co/auth/v1/admin/generate_link');
  });

  it('surfaces Supabase\'s own words on a refusal, not just the status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ msg: 'User not found' }),
    }) as unknown as typeof fetch;
    await expect(call(fetchImpl)).rejects.toThrow('User not found');
  });

  it('does not pretend a 200 with no code is a success', async () => {
    // Silently returning undefined would print an empty box and look like the
    // script worked.
    await expect(call(asFetch(ok({ properties: {} })))).rejects.toThrow(/no code/i);
  });

  it('reports an HTML error page as such rather than crashing on JSON.parse', async () => {
    // A proxy or a wrong host returns HTML. The parse error alone says nothing.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => '<html><body>Bad Gateway</body></html>',
    }) as unknown as typeof fetch;
    await expect(call(fetchImpl)).rejects.toThrow(/not JSON/);
  });
});

/**
 * Running the script for real, against a stub Supabase.
 *
 * The unit tests above all passed while the script itself printed nothing and
 * exited 0 — twice, for two different reasons, both in the prompt handling
 * rather than in the logic. Nothing short of actually running it would have
 * caught either:
 *
 *   1. A readline interface per question. The first buffers everything on
 *      stdin then closes; the second is handed an empty stream, its callback
 *      never fires, and node exits successfully having done nothing.
 *   2. `terminal: true` on a pipe, which echoed the service_role key in full
 *      under the prompt that had just promised it would not be shown.
 */
describe('running the script end to end', () => {
  const { spawn } = require('node:child_process') as typeof import('node:child_process');
  const { createServer } = require('node:http') as typeof import('node:http');
  const { writeFileSync, mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const { tmpdir } = require('node:os') as typeof import('node:os');

  async function run(email: string, key: string) {
    const received: { body: string; auth: string | undefined }[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ body, auth: req.headers.authorization });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ email_otp: '483920' }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;

    const dir = mkdtempSync(join(tmpdir(), 'dvt-'));
    const envFile = join(dir, '.env');
    writeFileSync(envFile, `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:${port}\n`);

    const output = await new Promise<{ text: string; code: number | null }>((resolve) => {
      const child = spawn('node', ['scripts/dev-get-login-code.mjs'], {
        env: { ...process.env, DVT_ENV_FILE: envFile },
      });
      let text = '';
      child.stdout.on('data', (d) => (text += d));
      child.stderr.on('data', (d) => (text += d));
      child.stdin.write(`${email}\n${key}\n`);
      child.on('close', (code) => resolve({ text, code }));
    });

    server.close();
    return { ...output, received };
  }

  it('prints the code, and never the key', async () => {
    const { text, code, received } = await run('rep01@monos.mn', SERVICE_KEY);

    expect(code).toBe(0);
    expect(text).toContain('483920');
    // The whole promise of the silent prompt.
    expect(text).not.toContain(SERVICE_KEY);
    expect(JSON.parse(received[0].body)).toEqual({ type: 'magiclink', email: 'rep01@monos.mn' });
    expect(received[0].auth).toBe(`Bearer ${SERVICE_KEY}`);
  }, 20_000);

  it('names the mistake when given the anon key, and calls nothing', async () => {
    const { text, code, received } = await run('rep01@monos.mn', ANON_KEY);

    expect(code).toBe(1);
    expect(text).toContain('anon');
    expect(received).toHaveLength(0);
  }, 20_000);
});
