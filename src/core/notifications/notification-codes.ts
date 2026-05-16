// Notification catalog. Producers MUST publish notifications using one of these
// codes — the code is the stable machine key for filtering, analytics, and
// cross-version routing. `category` is the human-facing display group;
// `defaultTitle` is overridable per call but lives here as a sane default.

export interface NotificationCode {
  code: string;
  category: string;
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
});

export type NotificationCodeKey = keyof typeof NOTIFICATION_CODES;
