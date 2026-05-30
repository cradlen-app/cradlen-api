import pino from 'pino';
import { Writable } from 'stream';

// We import the production logger only to confirm it exists and didn't
// throw on initialization. The redaction assertions below build a
// throwaway pino instance with the same paths so we can read output
// deterministically without touching stdout.
import { logger as productionLogger, REDACTION_PATHS } from './logger.js';

function captureLog(value: object): Record<string, unknown> {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  const local = pino(
    { redact: { paths: REDACTION_PATHS, censor: '[REDACTED]' } },
    sink,
  );
  local.info(value, 'test');
  return JSON.parse(chunks.join('')) as Record<string, unknown>;
}

describe('logger redaction', () => {
  it('initializes without throwing', () => {
    expect(productionLogger).toBeDefined();
  });

  it('redacts request-body credentials and OTP codes', () => {
    const out = captureLog({
      req: {
        body: {
          email: 'sara@example.com',
          password: 'Password1!',
          confirm_password: 'Password1!',
          new_password: 'NewPassword1!',
          code: '123456',
          refresh_token: 'eyJ...',
          reset_token: 'eyJ...',
          signup_token: 'eyJ...',
          selection_token: 'eyJ...',
        },
      },
    });
    const body = (out.req as { body: Record<string, unknown> }).body;
    expect(body.email).toBe('sara@example.com');
    for (const field of [
      'password',
      'confirm_password',
      'new_password',
      'code',
      'refresh_token',
      'reset_token',
      'signup_token',
      'selection_token',
    ]) {
      expect(body[field]).toBe('[REDACTED]');
    }
  });

  it('redacts request headers carrying secrets', () => {
    const out = captureLog({
      req: {
        headers: {
          authorization: 'Bearer eyJ...',
          cookie: 'session=abc',
          'x-request-id': 'req-1',
        },
      },
    });
    const headers = (out.req as { headers: Record<string, unknown> }).headers;
    expect(headers.authorization).toBe('[REDACTED]');
    expect(headers.cookie).toBe('[REDACTED]');
    expect(headers['x-request-id']).toBe('req-1');
  });

  it('redacts server-side echoes of password and token hashes', () => {
    const out = captureLog({
      user: { email: 'sara@example.com' },
      password_hashed: '$2b$12$...',
      token_hash: '$2b$12$...',
      code_hash: '$2b$10$...',
      access_token: 'eyJ...',
      refresh_token: 'eyJ...',
    });
    expect(out.password_hashed).toBe('[REDACTED]');
    expect(out.token_hash).toBe('[REDACTED]');
    expect(out.code_hash).toBe('[REDACTED]');
    expect(out.access_token).toBe('[REDACTED]');
    expect(out.refresh_token).toBe('[REDACTED]');
  });
});
