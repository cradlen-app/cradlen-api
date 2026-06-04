/**
 * Egyptian national ID: exactly 14 digits. Shared by the patient signup-start
 * and login DTOs so the format rule lives in one place.
 */
export const NATIONAL_ID_REGEX = /^\d{14}$/;
export const NATIONAL_ID_MESSAGE = 'national_id must be exactly 14 digits';
