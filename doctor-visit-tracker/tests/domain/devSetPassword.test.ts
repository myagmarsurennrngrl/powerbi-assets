/**
 * The administrator's "give somebody a password" tool.
 *
 * It is the only way anyone gets a first password, so a failure here locks the
 * whole company out. Tested against a stub fetch and, at the end, by actually
 * running the script — the last dev script had two bugs that only showed up
 * when run, both in the prompt handling, both silent.
 */
import { describe, expect, it, vi } from 'vitest';
import { readEnvValue, roleOfKey, setPassword } from '../../scripts/dev-set-password.mjs';

function keyWithRole(role: string): string {
  const part = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${part({ alg: 'HS256' })}.${part({ role, iss: 'supabase' })}.c2lnbmF0dXJl`;
}
const SERVICE_KEY = keyWithRole('service_role');
const ANON_KEY = keyWithRole('anon');

/** A fetch stub that answers the two admin endpoints this script uses. */
function stubSupabase(existingUsers: { id: string; email: string }[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const impl = vi.fn(async (url: string, init: { method?: string; body?: string } = {}) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(init.body) : null,
    });

    if (url.includes('/admin/users?')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ users: existingUsers }) };
    }
    if (init.method === 'POST') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'new-user-id', email: 'x' }),
      };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'updated' }) };
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const BASE = { supabaseUrl: 'https://abc.supabase.co', serviceKey: SERVICE_KEY };

describe('an address that already has a login', () => {
  it('updates it in place instead of creating a second one', async () => {
    // Two logins for one address is the failure to avoid: app_user.auth_user_id
    // can only point at one, and the person may authenticate as the other.
    const { impl, calls } = stubSupabase([{ id: 'existing-id', email: 'rep01@monos.mn' }]);

    const result = await setPassword({
      ...BASE,
      email: 'rep01@monos.mn',
      password: 'улаанбаатар-хавар',
      fetchImpl: impl,
    });

    expect(result).toEqual({ userId: 'existing-id', created: false });
    const write = calls.find((c) => c.method === 'PUT');
    expect(write?.url).toBe('https://abc.supabase.co/auth/v1/admin/users/existing-id');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('matches the address case-insensitively', async () => {
    const { impl } = stubSupabase([{ id: 'existing-id', email: 'Rep01@Monos.MN' }]);
    const result = await setPassword({
      ...BASE,
      email: 'rep01@monos.mn',
      password: 'улаанбаатар-хавар',
      fetchImpl: impl,
    });
    expect(result.created).toBe(false);
  });

  it('confirms the address, which an unfinished code attempt left unconfirmed', async () => {
    // Supabase refuses a password sign-in for an unconfirmed address with the
    // same "Invalid login credentials" it uses for a wrong password. Without
    // this flag the symptom is indistinguishable from a typo.
    const { impl, calls } = stubSupabase([{ id: 'existing-id', email: 'rep01@monos.mn' }]);
    await setPassword({
      ...BASE,
      email: 'rep01@monos.mn',
      password: 'улаанбаатар-хавар',
      fetchImpl: impl,
    });
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      password: 'улаанбаатар-хавар',
      email_confirm: true,
    });
  });
});

describe('an address with no login yet', () => {
  it('creates one, already confirmed', async () => {
    const { impl, calls } = stubSupabase([{ id: 'someone-else', email: 'other@monos.mn' }]);

    const result = await setPassword({
      ...BASE,
      email: 'new@monos.mn',
      password: 'улаанбаатар-хавар',
      fetchImpl: impl,
    });

    expect(result).toEqual({ userId: 'new-user-id', created: true });
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      email: 'new@monos.mn',
      password: 'улаанбаатар-хавар',
      email_confirm: true,
    });
  });

  it('lower-cases the address it creates', async () => {
    const { impl, calls } = stubSupabase([]);
    await setPassword({
      ...BASE,
      email: '  New@Monos.MN  ',
      password: 'улаанбаатар-хавар',
      fetchImpl: impl,
    });
    expect((calls.find((c) => c.method === 'POST')?.body as { email: string }).email).toBe(
      'new@monos.mn',
    );
  });
});

describe('failures', () => {
  it('surfaces Supabase\'s own words', async () => {
    const impl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ msg: 'not_admin' }),
    }) as unknown as typeof fetch;
    await expect(
      setPassword({ ...BASE, email: 'a@monos.mn', password: 'x'.repeat(12), fetchImpl: impl }),
    ).rejects.toThrow('not_admin');
  });

  it('reports an HTML error page as such rather than crashing on JSON.parse', async () => {
    const impl = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => '<html>Bad Gateway</html>',
    }) as unknown as typeof fetch;
    await expect(
      setPassword({ ...BASE, email: 'a@monos.mn', password: 'x'.repeat(12), fetchImpl: impl }),
    ).rejects.toThrow(/not JSON/);
  });

  it('does not report success when the create returns no id', async () => {
    const impl = vi.fn(async (url: string, init: { method?: string } = {}) => {
      if (url.includes('/admin/users?')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ users: [] }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({}) };
    }) as unknown as typeof fetch;
    await expect(
      setPassword({ ...BASE, email: 'a@monos.mn', password: 'x'.repeat(12), fetchImpl: impl }),
    ).rejects.toThrow(/created no user/);
  });
});

describe('telling the two keys apart', () => {
  it('recognises each', () => {
    expect(roleOfKey(SERVICE_KEY)).toBe('service_role');
    expect(roleOfKey(ANON_KEY)).toBe('anon');
    expect(roleOfKey('nonsense')).toBeNull();
  });
});

describe('reading .env', () => {
  it('finds the URL', () => {
    expect(
      readEnvValue('EXPO_PUBLIC_SUPABASE_URL=https://a.supabase.co\n', 'EXPO_PUBLIC_SUPABASE_URL'),
    ).toBe('https://a.supabase.co');
  });
});

/**
 * Actually running it. The unit tests above cannot see the prompt handling,
 * which is where the previous script's two silent bugs lived.
 */
describe('running the script end to end', () => {
  const { spawn } = require('node:child_process') as typeof import('node:child_process');
  const { createServer } = require('node:http') as typeof import('node:http');
  const { writeFileSync, mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const { tmpdir } = require('node:os') as typeof import('node:os');

  async function run(lines: string[]) {
    const received: { url: string; method: string; body: string }[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ url: req.url ?? '', method: req.method ?? '', body });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          (req.url ?? '').includes('/admin/users?')
            ? JSON.stringify({ users: [] })
            : JSON.stringify({ id: 'created-id' }),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;

    const envFile = join(mkdtempSync(join(tmpdir(), 'dvt-')), '.env');
    writeFileSync(envFile, `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:${port}\n`);

    const result = await new Promise<{ text: string; code: number | null }>((resolve) => {
      const child = spawn('node', ['scripts/dev-set-password.mjs'], {
        env: { ...process.env, DVT_ENV_FILE: envFile },
      });
      let text = '';
      child.stdout.on('data', (d) => (text += d));
      child.stderr.on('data', (d) => (text += d));
      child.stdin.write(lines.map((l) => `${l}\n`).join(''));
      child.on('close', (code) => resolve({ text, code }));
    });

    server.close();
    return { ...result, received };
  }

  const PASSWORD = 'улаанбаатар-хавар';

  it('sets the password and leaks neither it nor the key', async () => {
    const { text, code, received } = await run([
      'rep01@monos.mn',
      PASSWORD,
      PASSWORD,
      SERVICE_KEY,
    ]);

    expect(code).toBe(0);
    expect(text).toContain('нууц үг тохирлоо');
    expect(text).not.toContain(SERVICE_KEY);
    expect(text).not.toContain(PASSWORD);
    // And it reminds the administrator to link app_user, without which the
    // person signs in and then sees «бүртгэл идэвхжээгүй».
    expect(text).toContain('auth_user_id');
    expect(received.some((r) => r.method === 'POST' && r.body.includes('email_confirm'))).toBe(true);
  }, 20_000);

  it('refuses a mistyped confirmation before touching Supabase', async () => {
    const { text, code, received } = await run([
      'rep01@monos.mn',
      PASSWORD,
      'өөр-нууц-үг-байна',
      SERVICE_KEY,
    ]);
    expect(code).toBe(1);
    expect(text).toContain('таарахгүй');
    expect(received).toHaveLength(0);
  }, 20_000);

  it('refuses a short password before touching Supabase', async () => {
    const { text, code, received } = await run(['rep01@monos.mn', 'short', 'short', SERVICE_KEY]);
    expect(code).toBe(1);
    expect(text).toContain('10 тэмдэгт');
    expect(received).toHaveLength(0);
  }, 20_000);

  it('names the anon key when that is pasted, and calls nothing', async () => {
    const { text, code, received } = await run(['rep01@monos.mn', PASSWORD, PASSWORD, ANON_KEY]);
    expect(code).toBe(1);
    expect(text).toContain('anon');
    expect(received).toHaveLength(0);
  }, 20_000);
});
