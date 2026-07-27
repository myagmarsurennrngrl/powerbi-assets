/**
 * E-mail domain rules.
 *
 * IMPORTANT: this file is a courtesy, not a security control. It exists so the
 * login screen can say "that address will not work" before wasting the user's
 * time on a one-time code. The real enforcement is a trigger on auth.users in
 * the database (see supabase/migrations/..._login_gate.sql) which refuses to
 * create the account at all.
 *
 * Anyone editing this file should assume an attacker has already deleted it.
 */

/**
 * Deliberately conservative. It rejects obvious rubbish without trying to
 * implement RFC 5322, which is a trap: over-clever e-mail regexes reject valid
 * addresses far more often than they catch invalid ones.
 */
const BASIC_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailFormat(email: string): boolean {
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  if (trimmed.includes('..')) return false;
  return BASIC_EMAIL.test(trimmed);
}

/** Lower-cased domain part, or null when the address is not usable. */
export function extractDomain(email: string): string | null {
  if (!isValidEmailFormat(email)) return null;
  const parts = email.trim().toLowerCase().split('@');
  const domain = parts[1];
  return domain && domain.length > 0 ? domain : null;
}

/**
 * Exact domain match only.
 *
 * Subdomains are NOT accepted: `user@evil.company.mn` must not pass a
 * `company.mn` rule, because anybody who controls a subdomain could otherwise
 * mint themselves an account. If the company genuinely uses a subdomain, an
 * administrator adds it to the approved list as its own entry.
 */
export function isAllowedEmailDomain(email: string, allowedDomains: readonly string[]): boolean {
  const domain = extractDomain(email);
  if (domain === null) return false;

  return allowedDomains.some((allowed) => {
    const normalised = allowed.trim().toLowerCase().replace(/^@/, '');
    return normalised.length > 0 && normalised === domain;
  });
}

export type EmailCheck =
  | { ok: true; email: string }
  | { ok: false; reason: 'empty' | 'format' | 'domain' };

/** Single entry point used by the login screen. */
export function checkLoginEmail(
  rawEmail: string,
  allowedDomains: readonly string[],
): EmailCheck {
  const email = rawEmail.trim().toLowerCase();
  if (email.length === 0) return { ok: false, reason: 'empty' };
  if (!isValidEmailFormat(email)) return { ok: false, reason: 'format' };
  if (!isAllowedEmailDomain(email, allowedDomains)) return { ok: false, reason: 'domain' };
  return { ok: true, email };
}
