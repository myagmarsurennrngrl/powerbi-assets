import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  byteLength,
  checkPassword,
  isAcceptablePassword,
} from '../../src/domain/password';

const EMAIL = 'ariunzaya@monos.mn';

describe('acceptable passwords', () => {
  it('accepts a long memorable phrase', () => {
    expect(checkPassword('улаанбаатар-хавар-2026', EMAIL)).toBeNull();
  });

  it('accepts a password with no digits or symbols at all', () => {
    // Deliberate: length resists guessing, composition rules produce Password1!.
    expect(checkPassword('намрынбороо', EMAIL)).toBeNull();
  });

  it('accepts internal and edge whitespace as real characters', () => {
    expect(checkPassword('хоёр үг хамт', EMAIL)).toBeNull();
    // Not trimmed — trimming makes a working password stop working.
    expect(checkPassword(' зайтайнууц ', EMAIL)).toBeNull();
  });
});

describe('rejections', () => {
  it('rejects anything shorter than the minimum', () => {
    expect(checkPassword('короткий', EMAIL)).toBe('too_short');
    expect(checkPassword('a'.repeat(PASSWORD_MIN_LENGTH - 1), EMAIL)).toBe('too_short');
    expect(checkPassword('ab'.repeat(PASSWORD_MIN_LENGTH / 2), EMAIL)).toBeNull();
  });

  it('rejects whitespace pretending to be a password', () => {
    expect(checkPassword('              ', EMAIL)).toBe('whitespace_only');
  });

  it('rejects one character repeated, however long', () => {
    expect(checkPassword('ааааааааааааааа', EMAIL)).toBe('only_one_character');
  });

  it('rejects the email address itself', () => {
    expect(checkPassword(EMAIL, EMAIL)).toBe('same_as_email');
  });

  it('rejects the part before the @', () => {
    // Long enough to clear the length rule, so it is this rule being tested.
    expect(checkPassword('ariunzaya-a', 'ariunzaya-a@monos.mn')).toBe('same_as_email');
  });

  it('reports the length first when a short password is also the local part', () => {
    // "too short" is the more actionable of the two messages.
    expect(checkPassword('ariunzaya', 'ariunzaya@monos.mn')).toBe('too_short');
  });

  it('does not treat a short local part as the password', () => {
    // 'ab' is too short to be worth this rule, and would false-positive.
    expect(checkPassword('abcdefghijkl', 'ab@monos.mn')).toBeNull();
  });

  it('rejects the obvious choices, including with digits appended', () => {
    expect(checkPassword('password12', EMAIL)).toBe('too_obvious');
    expect(checkPassword('monos12345', EMAIL)).toBe('too_obvious');
    expect(checkPassword('MONOS-2026', EMAIL)).toBe('too_obvious');
    expect(checkPassword('эмч2026!!!', EMAIL)).toBe('too_obvious');
    expect(checkPassword('qwerty1234', EMAIL)).toBe('too_obvious');
  });

  it('does not reject a password that merely contains a forbidden word', () => {
    // The rule is "is", not "contains" — otherwise good passphrases are refused
    // for containing 'monos' somewhere in the middle.
    expect(checkPassword('монос-бол-манай-компани', EMAIL)).toBeNull();
  });
});

describe('the bcrypt byte limit', () => {
  // Supabase refuses past 72 bytes with an English error; caught here instead.
  it('counts bytes, not characters', () => {
    expect(byteLength('abc')).toBe(3);
    expect(byteLength('абв')).toBe(6); // Cyrillic is 2 bytes each
    expect(byteLength('🔒')).toBe(4);
  });

  it('rejects a long Mongolian password that is under 72 CHARACTERS', () => {
    const password = 'а'.repeat(40) + 'б'; // 41 characters, 82 bytes
    expect(password.length).toBeLessThan(PASSWORD_MAX_BYTES);
    expect(byteLength(password)).toBeGreaterThan(PASSWORD_MAX_BYTES);
    expect(checkPassword(password, EMAIL)).toBe('too_long');
  });

  it('accepts one exactly at the limit', () => {
    const password = 'x'.repeat(PASSWORD_MAX_BYTES - 1) + 'y';
    expect(byteLength(password)).toBe(PASSWORD_MAX_BYTES);
    expect(checkPassword(password, EMAIL)).toBeNull();
  });
});

describe('the boolean wrapper', () => {
  it('agrees with checkPassword', () => {
    expect(isAcceptablePassword('улаанбаатар-хавар', EMAIL)).toBe(true);
    expect(isAcceptablePassword('short', EMAIL)).toBe(false);
  });
});
