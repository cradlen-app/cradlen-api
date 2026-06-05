// Patient-facing notification catalog. Producers publish notifications using one
// of these codes — the code is the stable machine key; `category` is the display
// group; `defaultTitle` is overridable per call but lives here as a sane default.

export interface PatientNotificationCode {
  code: string;
  category: string;
  defaultTitle: string;
}

const def = <T extends Record<string, PatientNotificationCode>>(t: T): T => t;

export const PATIENT_NOTIFICATION_CODES = def({
  VISIT_PRESCRIPTION_ISSUED: {
    code: 'visit.prescription_issued',
    category: 'medicine',
    defaultTitle: 'New prescription',
  },
  VISIT_INVESTIGATION_ORDERED: {
    code: 'visit.investigation_ordered',
    category: 'report',
    defaultTitle: 'New tests ordered',
  },
  INVESTIGATION_REVIEWED: {
    code: 'investigation.reviewed',
    category: 'report',
    defaultTitle: 'Test result ready',
  },
});

export type PatientNotificationCodeKey =
  keyof typeof PATIENT_NOTIFICATION_CODES;
