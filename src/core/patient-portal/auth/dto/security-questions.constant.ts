/**
 * Canonical set of patient security-question keys. The patient picks one at
 * self-signup; the forgot-password flow echoes the stored key back so the UI
 * can render the question. Keys (not localized text) are what we persist and
 * validate — the frontend owns the EN/AR labels under `auth.securityQuestions`.
 *
 * Keep this list in sync with the frontend
 * `src/features/auth/lib/security-questions.ts`.
 */
export const SECURITY_QUESTION_KEYS = [
  'MOTHERS_MAIDEN_NAME',
  'BIRTH_CITY',
  'FIRST_SCHOOL',
  'CHILDHOOD_NICKNAME',
  'FAVORITE_TEACHER',
] as const;

export type SecurityQuestionKey = (typeof SECURITY_QUESTION_KEYS)[number];
