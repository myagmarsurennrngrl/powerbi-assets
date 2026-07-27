/**
 * Mongolian labels for the database's English enum codes.
 *
 * The database stores English codes so that reports and Power BI never break
 * when the Mongolian wording is improved. Translation happens here, at the
 * edge, and nowhere else.
 */

export const userRoleMn = {
  representative: 'Эмнэлгийн төлөөлөгч',
  manager: 'Менежер',
  administrator: 'Администратор',
} as const;

export const planStatusMn = {
  draft: 'Ноорог',
  submitted: 'Илгээсэн',
  approved: 'Батлагдсан',
  rejected: 'Татгалзсан',
  active: 'Идэвхтэй',
  completed: 'Дууссан',
  locked: 'Түгжигдсэн',
} as const;

export const visitStatusMn = {
  planned: 'Төлөвлөсөн',
  in_progress: 'Үргэлжилж байна',
  completed: 'Дууссан',
  missed: 'Хийгдээгүй',
  rescheduled: 'Хойшлуулсан',
  cancellation_requested: 'Цуцлах хүсэлт илгээсэн',
  cancelled_approved: 'Зөвшөөрөгдсөн цуцлалт',
  cancelled_unapproved: 'Зөвшөөрөгдөөгүй цуцлалт',
} as const;

export const meetingStatusMn = {
  doctor_met: 'Эмчтэй уулзсан',
  doctor_unavailable: 'Эмч байгаагүй',
  clinic_closed: 'Эмнэлэг хаалттай',
  meeting_postponed: 'Уулзалт хойшилсон',
  met_clinic_staff_only: 'Зөвхөн ажилтантай уулзсан',
  other: 'Бусад',
} as const;

export const visitOutcomeMn = {
  product_introduced: 'Бүтээгдэхүүн танилцуулсан',
  doctor_interested: 'Эмч сонирхсон',
  follow_up_requested: 'Дараагийн уулзалт хүссэн',
  sample_requested: 'Сорьц хүссэн',
  training_requested: 'Сургалт хүссэн',
  not_interested: 'Сонирхоогүй',
  already_recommending: 'Аль хэдийн санал болгож байгаа',
  other: 'Бусад',
} as const;

export const interestLevelMn = {
  none: 'Байхгүй',
  low: 'Бага',
  medium: 'Дунд',
  high: 'Өндөр',
} as const;

export const exceptionReasonMn = {
  doctor_unavailable: 'Эмч байхгүй',
  clinic_closed: 'Эмнэлэг хаалттай',
  emergency: 'Яаралтай тохиолдол',
  sick_leave: 'Өвчтэй',
  official_assignment: 'Албан томилолт',
  gps_problem: 'GPS-ийн асуудал',
  wrong_clinic_coordinates: 'Эмнэлгийн байршил буруу',
  appointment_rescheduled: 'Уулзалт хойшилсон',
  other: 'Бусад',
} as const;

export const exceptionStatusMn = {
  pending: 'Хүлээгдэж буй',
  approved: 'Зөвшөөрсөн',
  rejected: 'Татгалзсан',
} as const;

export const followUpStatusMn = {
  open: 'Хүлээгдэж буй',
  done: 'Хийгдсэн',
  cancelled: 'Цуцалсан',
} as const;

export const syncSourceMn = {
  online: 'Онлайн',
  offline: 'Офлайн',
} as const;

/** Short day-of-week labels, matching doctor_clinic.available_days codes. */
export const weekdayMn = {
  mon: 'Да',
  tue: 'Мя',
  wed: 'Лх',
  thu: 'Пү',
  fri: 'Ба',
  sat: 'Бя',
  sun: 'Ня',
} as const;

/** Full weekday names, Monday first (ISO order). */
export const weekdayFullMn = [
  'Даваа',
  'Мягмар',
  'Лхагва',
  'Пүрэв',
  'Баасан',
  'Бямба',
  'Ням',
] as const;

/**
 * Translate an enum code, falling back to the raw code rather than showing an
 * empty string. If a new code appears in the database before the app is
 * updated, the user sees something honest instead of a blank.
 */
export function translateEnum<T extends Record<string, string>>(
  dictionary: T,
  code: string | null | undefined,
): string {
  if (!code) return '—';
  return (dictionary as Record<string, string>)[code] ?? code;
}
