/**
 * E-mail domain restriction — client side.
 * The authoritative version of these rules lives in the database and is tested
 * by supabase/tests/01_email_domain_restriction.test.sql. These tests cover the
 * message the user sees before any network call happens.
 */
import { describe, expect, it } from 'vitest';
import {
  checkLoginEmail,
  extractDomain,
  isAllowedEmailDomain,
  isValidEmailFormat,
} from '@/domain/email';

const ALLOWED = ['company.mn'];

describe('isValidEmailFormat', () => {
  it('accepts ordinary work addresses', () => {
    expect(isValidEmailFormat('rep1@company.mn')).toBe(true);
    expect(isValidEmailFormat('first.last@company.mn')).toBe(true);
    expect(isValidEmailFormat('a+tag@company.mn')).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(isValidEmailFormat('')).toBe(false);
    expect(isValidEmailFormat('   ')).toBe(false);
    expect(isValidEmailFormat('no-at-sign.mn')).toBe(false);
    expect(isValidEmailFormat('two@@company.mn')).toBe(false);
    expect(isValidEmailFormat('no-domain@')).toBe(false);
    expect(isValidEmailFormat('@company.mn')).toBe(false);
    expect(isValidEmailFormat('spaces in@company.mn')).toBe(false);
    expect(isValidEmailFormat('missing-tld@company')).toBe(false);
    expect(isValidEmailFormat('double..dot@company.mn')).toBe(false);
  });

  it('rejects absurdly long addresses', () => {
    expect(isValidEmailFormat(`${'a'.repeat(250)}@company.mn`)).toBe(false);
  });
});

describe('extractDomain', () => {
  it('lower-cases the domain', () => {
    expect(extractDomain('Rep1@Company.MN')).toBe('company.mn');
  });

  it('returns null for invalid addresses', () => {
    expect(extractDomain('nonsense')).toBeNull();
  });
});

describe('isAllowedEmailDomain', () => {
  it('accepts an exact match, regardless of case or whitespace', () => {
    expect(isAllowedEmailDomain('rep1@company.mn', ALLOWED)).toBe(true);
    expect(isAllowedEmailDomain('  REP1@COMPANY.MN  ', ALLOWED)).toBe(true);
    expect(isAllowedEmailDomain('rep1@company.mn', [' Company.MN '])).toBe(true);
    expect(isAllowedEmailDomain('rep1@company.mn', ['@company.mn'])).toBe(true);
  });

  it('rejects public mail providers', () => {
    expect(isAllowedEmailDomain('someone@gmail.com', ALLOWED)).toBe(false);
    expect(isAllowedEmailDomain('someone@yahoo.com', ALLOWED)).toBe(false);
  });

  /**
   * The important one. Anybody who controls a subdomain could otherwise mint
   * themselves an account, so only exact matches are accepted.
   */
  it('rejects subdomains and look-alike domains', () => {
    expect(isAllowedEmailDomain('attacker@evil.company.mn', ALLOWED)).toBe(false);
    expect(isAllowedEmailDomain('attacker@company.mn.evil.com', ALLOWED)).toBe(false);
    expect(isAllowedEmailDomain('attacker@notcompany.mn', ALLOWED)).toBe(false);
    expect(isAllowedEmailDomain('attacker@company.mnx', ALLOWED)).toBe(false);
    expect(isAllowedEmailDomain('attacker@xcompany.mn', ALLOWED)).toBe(false);
  });

  it('rejects everything when no domain is configured', () => {
    expect(isAllowedEmailDomain('rep1@company.mn', [])).toBe(false);
    expect(isAllowedEmailDomain('rep1@company.mn', ['', '  '])).toBe(false);
  });

  it('supports several approved domains', () => {
    const many = ['company.mn', 'company.com', 'branch.company.mn'];
    expect(isAllowedEmailDomain('a@company.mn', many)).toBe(true);
    expect(isAllowedEmailDomain('a@company.com', many)).toBe(true);
    expect(isAllowedEmailDomain('a@branch.company.mn', many)).toBe(true);
    expect(isAllowedEmailDomain('a@other.company.mn', many)).toBe(false);
  });
});

describe('checkLoginEmail', () => {
  it('reports the specific reason so the screen can show the right message', () => {
    expect(checkLoginEmail('', ALLOWED)).toEqual({ ok: false, reason: 'empty' });
    expect(checkLoginEmail('   ', ALLOWED)).toEqual({ ok: false, reason: 'empty' });
    expect(checkLoginEmail('rubbish', ALLOWED)).toEqual({ ok: false, reason: 'format' });
    expect(checkLoginEmail('a@gmail.com', ALLOWED)).toEqual({ ok: false, reason: 'domain' });
  });

  it('normalises the address it returns', () => {
    expect(checkLoginEmail('  REP1@Company.MN ', ALLOWED)).toEqual({
      ok: true,
      email: 'rep1@company.mn',
    });
  });
});
