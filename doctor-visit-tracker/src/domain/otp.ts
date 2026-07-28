/**
 * The one-time code typed at login.
 *
 * WHY THIS IS NOT JUST `slice(0, 6)`
 * ----------------------------------
 * It was, and that was a bug. The length of a Supabase email OTP is a project
 * setting — **Authentication → Sign In / Providers → Email → Email OTP
 * Length** — which accepts 6 to 10 and is not always 6.
 *
 * On a project configured for 8, the login screen truncated the code to its
 * first six digits and then reported «Код буруу эсвэл хугацаа нь дууссан
 * байна». The code was neither wrong nor expired; the app had quietly thrown
 * away the last two digits. Nothing on screen could have told anyone that, and
 * the two remaining digits were never visible to compare against.
 *
 * So the app accepts the whole range and lets the server decide. Hard-coding a
 * length here buys nothing — the server checks it anyway — and costs an
 * unfalsifiable error message when the assumption is wrong.
 */

/** Supabase's own bounds for Email OTP Length. */
export const OTP_MIN_LENGTH = 6;
export const OTP_MAX_LENGTH = 10;

/**
 * Clean up what was typed or pasted into the code field.
 *
 * Pasting from an email client commonly brings spaces, a trailing newline, or
 * a non-breaking space with it; a code pasted with a stray space is otherwise
 * rejected for no visible reason.
 */
export function sanitiseOtpInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, OTP_MAX_LENGTH);
}

/**
 * Is this long enough to be worth sending?
 *
 * Only guards against submitting an obviously partial code. Anything at or
 * above the minimum goes to the server, which is the only thing that knows the
 * configured length.
 */
export function isSubmittableOtp(code: string): boolean {
  return sanitiseOtpInput(code).length >= OTP_MIN_LENGTH;
}
