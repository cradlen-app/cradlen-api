import { registerAs } from '@nestjs/config';

export interface PushConfig {
  /** Web Push only runs when a VAPID keypair is configured. */
  enabled: boolean;
  subject: string;
  publicKey: string;
  privateKey: string;
}

/**
 * VAPID configuration for admin Web Push. Keys are optional: when unset the
 * PushService stays disabled and silently no-ops, so a deploy without push
 * secrets boots normally instead of failing at startup.
 */
export default registerAs('push', (): PushConfig => {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? '';
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? '';
  return {
    enabled: Boolean(publicKey && privateKey),
    subject: process.env.VAPID_SUBJECT ?? 'mailto:cradlen.app@gmail.com',
    publicKey,
    privateKey,
  };
});
