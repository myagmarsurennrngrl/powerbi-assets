/**
 * Reading the two values out of `.env`.
 *
 * These are typed by hand, by a non-developer, into a file format with no
 * quoting rules. Every mistake below has actually been made.
 *
 * The one that prompted these tests: a malformed URL passed validation and
 * then threw deep inside the Supabase client —
 *
 *     [Error: Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.]
 *
 * — as a red screen with a stack trace pointing at supabase.ts, which says
 * nothing about the file that needs editing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const URL_KEY = 'EXPO_PUBLIC_SUPABASE_URL';
const KEY_KEY = 'EXPO_PUBLIC_SUPABASE_ANON_KEY';

/** A structurally valid anon key: three dot-separated parts, like any JWT. */
const GOOD_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl';
const GOOD_URL = 'https://abcdefghijklm.supabase.co';

/**
 * `src/lib/env.ts` reads `process.env.EXPO_PUBLIC_*` as literals, because Expo
 * substitutes them at build time. Set them, then import the module fresh so
 * the read happens against the values under test.
 */
async function readWith(url: string | undefined, key: string | undefined) {
  if (url === undefined) delete process.env[URL_KEY];
  else process.env[URL_KEY] = url;
  if (key === undefined) delete process.env[KEY_KEY];
  else process.env[KEY_KEY] = key;

  vi.resetModules();
  const { readEnv } = await import('../../src/lib/env');
  return readEnv();
}

const original = { url: process.env[URL_KEY], key: process.env[KEY_KEY] };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (original.url === undefined) delete process.env[URL_KEY];
  else process.env[URL_KEY] = original.url;
  if (original.key === undefined) delete process.env[KEY_KEY];
  else process.env[KEY_KEY] = original.key;
});

describe('a correct configuration', () => {
  it('is accepted', async () => {
    const result = await readWith(GOOD_URL, GOOD_KEY);
    expect(result.ok).toBe(true);
    expect(result.env).toEqual({ supabaseUrl: GOOD_URL, supabaseAnonKey: GOOD_KEY });
    expect(result.problem).toBeNull();
  });
});

describe('mistakes made when editing .env by hand', () => {
  it('strips double quotes — .env has no quoting rules, so they become part of the value', async () => {
    const result = await readWith(`"${GOOD_URL}"`, `"${GOOD_KEY}"`);
    expect(result.ok).toBe(true);
    expect(result.env?.supabaseUrl).toBe(GOOD_URL);
    expect(result.env?.supabaseAnonKey).toBe(GOOD_KEY);
  });

  it('strips single quotes', async () => {
    const result = await readWith(`'${GOOD_URL}'`, GOOD_KEY);
    expect(result.env?.supabaseUrl).toBe(GOOD_URL);
  });

  it('trims a trailing space, which is invisible in an editor', async () => {
    const result = await readWith(`${GOOD_URL}  `, ` ${GOOD_KEY}`);
    expect(result.ok).toBe(true);
    expect(result.env?.supabaseUrl).toBe(GOOD_URL);
    expect(result.env?.supabaseAnonKey).toBe(GOOD_KEY);
  });

  it('trims a trailing carriage return, which Windows editors add', async () => {
    const result = await readWith(`${GOOD_URL}\r`, GOOD_KEY);
    expect(result.env?.supabaseUrl).toBe(GOOD_URL);
  });

  it('drops a trailing slash, which copying from the address bar adds', async () => {
    const result = await readWith(`${GOOD_URL}/`, GOOD_KEY);
    expect(result.ok).toBe(true);
    expect(result.env?.supabaseUrl).toBe(GOOD_URL);
  });
});

describe('values that are present but wrong', () => {
  it('rejects a URL with no scheme, and says so', async () => {
    const result = await readWith('abcdefghijklm.supabase.co', GOOD_KEY);
    expect(result.ok).toBe(false);
    expect(result.problem).toContain('https://');
    // Names the variable, so the person knows which line to edit.
    expect(result.problem).toContain(URL_KEY);
  });

  it('rejects a non-http scheme', async () => {
    const result = await readWith('postgresql://db.abc.supabase.co:5432', GOOD_KEY);
    expect(result.ok).toBe(false);
    expect(result.problem).toContain('https://');
  });

  /**
   * The real one. Typed by hand, missing both slashes:
   *
   *     EXPO_PUBLIC_SUPABASE_URL=https:vhkqjpakvuearcjmycsd.supabase.co
   *
   * `new URL()` accepts it and repairs it — the WHATWG parser fills in the
   * slashes for special schemes and reports a perfectly good hostname. So the
   * first version of this validation passed it straight through, and it threw
   * inside supabase-js instead, which checks the raw text against a regex.
   *
   * The lesson: validate the text in the file, not a URL object built from it.
   */
  it('rejects https: with no slashes — new URL() silently repairs this one', async () => {
    const typo = 'https:vhkqjpakvuearcjmycsd.supabase.co';
    // Guard the premise, so this test still means something if the parser changes.
    expect(new URL(typo).hostname).toBe('vhkqjpakvuearcjmycsd.supabase.co');

    const result = await readWith(typo, GOOD_KEY);
    expect(result.ok).toBe(false);
    expect(result.problem).toContain('https://');
    expect(result.problem).toContain(typo);
  });

  it('rejects https:/ with one slash', async () => {
    const result = await readWith('https:/abcdefghijklm.supabase.co', GOOD_KEY);
    expect(result.ok).toBe(false);
    expect(result.problem).toContain('https://');
  });

  it('rejects a hostname with no dot', async () => {
    const result = await readWith('https://localhost', GOOD_KEY);
    expect(result.ok).toBe(false);
    expect(result.problem).toBeTruthy();
  });

  it('rejects text that is not a URL at all', async () => {
    const result = await readWith('paste your url here', GOOD_KEY);
    expect(result.ok).toBe(false);
    expect(result.problem).toBeTruthy();
  });

  it('rejects a truncated anon key', async () => {
    // A half-selected paste. It otherwise fails much later, as a confusing
    // authentication error rather than a configuration one.
    const result = await readWith(GOOD_URL, 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xl');
    expect(result.ok).toBe(false);
    expect(result.problem).toContain(KEY_KEY);
  });

  it('quotes the offending value back, so it can be compared with the file', async () => {
    const result = await readWith('htps://abc.supabase.co', GOOD_KEY);
    expect(result.problem).toContain('htps://abc.supabase.co');
  });
});

describe('values that are absent', () => {
  it('reports both as missing when neither is set', async () => {
    const result = await readWith(undefined, undefined);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([URL_KEY, KEY_KEY]);
    // Missing is a different situation from malformed and gets a different
    // message: "fill in the file" versus "this line is wrong".
    expect(result.problem).toBeNull();
  });

  it('treats the untouched .env.example placeholders as missing', async () => {
    const result = await readWith(
      'https://your-project-ref.supabase.co',
      'paste-your-anon-public-key-here',
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([URL_KEY, KEY_KEY]);
  });

  it('treats an empty string as missing, not as malformed', async () => {
    const result = await readWith('', GOOD_KEY);
    expect(result.missing).toEqual([URL_KEY]);
    expect(result.problem).toBeNull();
  });
});
