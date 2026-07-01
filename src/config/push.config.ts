import { registerAs } from '@nestjs/config';

export interface PushConfig {
  /** Web Push only runs when a VAPID keypair is configured. */
  enabled: boolean;
  subject: string;
  publicKey: string;
  privateKey: string;
}

/**
 * web-push requires the VAPID subject to be a `mailto:` address or an
 * `https://` URL. A subject without a scheme (e.g. `www.cradlen.com`) makes
 * `setVapidDetails` throw at boot — so we treat an invalid subject as
 * "not configured" and keep push disabled instead of crashing the API.
 */
function isValidVapidSubject(subject: string): boolean {
  return subject.startsWith('mailto:') || subject.startsWith('https://');
}

/**
 * VAPID configuration for Web Push. Keys are optional: when unset — or when the
 * subject is malformed — the push services stay disabled and silently no-op, so
 * a deploy with missing or bad push secrets boots normally instead of failing
 * at startup.
 */
export default registerAs('push', (): PushConfig => {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? '';
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? '';
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:cradlen.app@gmail.com';
  return {
    enabled: Boolean(publicKey && privateKey) && isValidVapidSubject(subject),
    subject,
    publicKey,
    privateKey,
  };
});
