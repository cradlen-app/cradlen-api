import pushConfig from './push.config.js';

/**
 * Guards the boot-safety contract: push must only report `enabled` when both
 * keys are present AND the subject has a scheme web-push accepts. A malformed
 * subject (the 2026-06-30 incident: `www.cradlen.com` with no scheme) must
 * resolve to disabled, not a value that later crashes setVapidDetails.
 */
describe('push config', () => {
  const KEYS = {
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  };

  afterEach(() => {
    process.env.VAPID_PUBLIC_KEY = KEYS.VAPID_PUBLIC_KEY;
    process.env.VAPID_PRIVATE_KEY = KEYS.VAPID_PRIVATE_KEY;
    process.env.VAPID_SUBJECT = KEYS.VAPID_SUBJECT;
  });

  function load() {
    // registerAs returns the factory itself; invoking it reads env fresh.
    return pushConfig();
  }

  it('is enabled with keys and a mailto: subject', () => {
    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';
    process.env.VAPID_SUBJECT = 'mailto:team@cradlen.com';
    expect(load().enabled).toBe(true);
  });

  it('is enabled with keys and an https:// subject', () => {
    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';
    process.env.VAPID_SUBJECT = 'https://www.cradlen.com';
    expect(load().enabled).toBe(true);
  });

  it('is disabled when the subject has no scheme (would crash setVapidDetails)', () => {
    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';
    process.env.VAPID_SUBJECT = 'www.cradlen.com';
    const config = load();
    expect(config.enabled).toBe(false);
    // Subject is still surfaced so the operator can see the bad value in logs.
    expect(config.subject).toBe('www.cradlen.com');
  });

  it('is disabled when keys are missing', () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    process.env.VAPID_SUBJECT = 'mailto:team@cradlen.com';
    expect(load().enabled).toBe(false);
  });
});
