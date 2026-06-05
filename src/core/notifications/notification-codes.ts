// Notification catalog. Producers MUST publish notifications using one of these
// codes — the code is the stable machine key for filtering, analytics, and
// cross-version routing. `category` is the human-facing display group;
// `defaultTitle` is overridable per call but lives here as a sane default.

import type { NOTIFICATION_CATEGORIES } from './dto/notification.dto.js';

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface NotificationCode {
  code: string;
  category: NotificationCategory;
  defaultTitle: string;
}

const def = <T extends Record<string, NotificationCode>>(t: T): T => t;

export const NOTIFICATION_CODES = def({
  INVITATION_ACCEPTED: {
    code: 'invitation.accepted',
    category: 'staff',
    defaultTitle: 'Invitation Accepted',
  },
  INVITATION_DECLINED: {
    code: 'invitation.declined',
    category: 'staff',
    defaultTitle: 'Invitation Declined',
  },
  INVESTIGATION_RESULT_UPLOADED: {
    code: 'investigation.result_uploaded',
    category: 'report',
    defaultTitle: 'Test result uploaded',
  },
});

export type NotificationCodeKey = keyof typeof NOTIFICATION_CODES;
