/**
 * Password rules.
 *
 * WHY THESE RULES AND NOT THE USUAL ONES
 * --------------------------------------
 * No "must contain an uppercase letter, a digit and a symbol". That family of
 * rules reliably produces `Password1!` and a sticky note on the monitor. Length
 * is what actually resists guessing, so length is what is required.
 *
 * The one composition rule here is negative: the password may not simply be the
 * email address, the company name, or one of a handful of things people in this
 * organisation demonstrably reach for first.
 *
 * WHY THE MINIMUM IS 10 AND NOT 8
 * -------------------------------
 * Because there is no email delivery, there is no self-service reset: a
 * forgotten password costs an administrator's time and a conversation. And an
 * account here can read a whole team's visit history. Ten characters of
 * anything memorable is a low price for that; eight is the number people pick
 * when they have not thought about it.
 *
 * Supabase enforces its own minimum of 6 server-side. This is stricter and
 * runs first, so the message is in Mongolian and names the actual problem.
 */

export const PASSWORD_MIN_LENGTH = 10;

/**
 * Supabase rejects anything past 72 bytes — bcrypt's limit. A longer password
 * is not "stronger but truncated", it is refused outright with an English
 * error, so it is caught here.
 */
export const PASSWORD_MAX_BYTES = 72;

/**
 * Things that must not be the password, checked case-insensitively and
 * ignoring digits appended to the end (`monos2026` is `monos`).
 */
const FORBIDDEN = [
  'password',
  'passw0rd',
  'нууцүг',
  'monos',
  'monosmn',
  'doctor',
  'emch',
  'эмч',
  'qwerty',
  'asdfgh',
  '123456',
  'abcdef',
  'ulaanbaatar',
  'mongolia',
  'mongol',
];

/** What is wrong with this password, or null when nothing is. */
export type PasswordProblem =
  | 'too_short'
  | 'too_long'
  | 'same_as_email'
  | 'too_obvious'
  | 'only_one_character'
  | 'whitespace_only';

export function checkPassword(password: string, email: string): PasswordProblem | null {
  // Not trimmed: a leading or trailing space is a legitimate character, and
  // silently removing it means the password that worked once stops working.
  if (password.trim().length === 0) return 'whitespace_only';

  if (password.length < PASSWORD_MIN_LENGTH) return 'too_short';

  // Byte length, not character length: Cyrillic is two bytes per character in
  // UTF-8, so a 40-character Mongolian password is already 80 bytes.
  if (byteLength(password) > PASSWORD_MAX_BYTES) return 'too_long';

  const lower = password.toLowerCase();
  const local = email.trim().toLowerCase().split('@')[0] ?? '';

  if (lower === email.trim().toLowerCase()) return 'same_as_email';
  if (local.length >= 4 && lower === local) return 'same_as_email';

  // One repeated character passes any length rule and resists nothing.
  if (new Set(password).size === 1) return 'only_one_character';

  const stripped = lower.replace(/[^a-zа-яё]/gi, '');
  if (FORBIDDEN.includes(stripped)) return 'too_obvious';

  return null;
}

export function isAcceptablePassword(password: string, email: string): boolean {
  return checkPassword(password, email) === null;
}

/** UTF-8 byte length, without depending on Buffer (absent in React Native). */
export function byteLength(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}
