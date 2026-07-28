/**
 * The login code field.
 *
 * The bug these exist for: the field truncated to six digits, on a project
 * whose Email OTP Length was set to eight. The last two digits were discarded
 * before the code was ever sent, and the screen then said the code was wrong
 * or expired. It was neither.
 */
import { describe, expect, it } from 'vitest';
import {
  OTP_MAX_LENGTH,
  OTP_MIN_LENGTH,
  isSubmittableOtp,
  sanitiseOtpInput,
} from '../../src/domain/otp';

describe('cleaning up what was typed', () => {
  it('keeps a six-digit code', () => {
    expect(sanitiseOtpInput('483920')).toBe('483920');
  });

  it('keeps an EIGHT-digit code — the whole point', () => {
    // Truncating this to '48392' + '0' produced an unexplainable "wrong code".
    expect(sanitiseOtpInput('48392017')).toBe('48392017');
  });

  it('keeps a ten-digit code, the longest Supabase allows', () => {
    expect(sanitiseOtpInput('1234567890')).toBe('1234567890');
  });

  it('strips spaces a paste from an email client brings along', () => {
    expect(sanitiseOtpInput(' 483 920 ')).toBe('483920');
    expect(sanitiseOtpInput('483920\n')).toBe('483920');
    expect(sanitiseOtpInput('483 920')).toBe('483920');
  });

  it('strips letters, so a pasted sentence cannot be submitted', () => {
    expect(sanitiseOtpInput('Таны код: 483920')).toBe('483920');
  });

  it('stops at the maximum rather than accepting unbounded input', () => {
    expect(sanitiseOtpInput('1'.repeat(50))).toHaveLength(OTP_MAX_LENGTH);
  });

  it('turns nothing into nothing', () => {
    expect(sanitiseOtpInput('')).toBe('');
    expect(sanitiseOtpInput('abc')).toBe('');
  });
});

describe('deciding whether to send it', () => {
  it('rejects a partial code', () => {
    expect(isSubmittableOtp('4839')).toBe(false);
  });

  it('accepts anything from the minimum up', () => {
    expect(isSubmittableOtp('483920')).toBe(true);
    expect(isSubmittableOtp('48392017')).toBe(true);
    expect(isSubmittableOtp('1234567890')).toBe(true);
  });

  it('judges the cleaned value, not the raw one', () => {
    // Five digits dressed up as eight characters.
    expect(isSubmittableOtp('48 39 2')).toBe(false);
    expect(isSubmittableOtp('483 920')).toBe(true);
  });

  it('has bounds that match what Supabase accepts', () => {
    expect(OTP_MIN_LENGTH).toBe(6);
    expect(OTP_MAX_LENGTH).toBe(10);
  });
});
