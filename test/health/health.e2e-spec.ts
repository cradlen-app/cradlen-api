import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from '../helpers/app-factory';
import { disconnectTestPrisma } from '../helpers/prisma-test-client';

describe('GET /v1/health (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mailMock = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp(mailMock);
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestPrisma();
  });

  it('returns 200 with database up status (no auth required)', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/health')
      .expect(200);

    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.services.database).toBe('up');
    expect(res.body.data).toHaveProperty('uptime');
    expect(res.body.data).toHaveProperty('timestamp');
    expect(res.body.meta).toEqual({});
  });
});
