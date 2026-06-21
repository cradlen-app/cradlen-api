import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptor/response.interceptor';
import { LoggingInterceptor } from '../../src/common/interceptor/logging.interceptor';
import { RequestIdMiddleware } from '../../src/common/middleware/request-id.middleware';
import { EmailService } from '../../src/infrastructure/email/email.service';
import { StorageService } from '../../src/infrastructure/storage/storage.service';

export async function createTestApp(
  mailMock: jest.Mock,
  storageMock?: Partial<StorageService>,
): Promise<INestApplication> {
  let builder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(EmailService)
    .useValue({
      sendVerificationEmail: mailMock,
      sendPasswordResetEmail: mailMock,
      sendStaffInvitationEmail: mailMock,
      sendPhoneOtp: mailMock,
    });

  if (storageMock) {
    builder = builder.overrideProvider(StorageService).useValue(storageMock);
  }

  const moduleFixture = await builder.compile();

  const app = moduleFixture.createNestApplication();

  const mid = new RequestIdMiddleware();
  app.use(mid.use.bind(mid));

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new ResponseInterceptor(),
  );

  app.enableVersioning({
    type: VersioningType.URI,
    prefix: 'v',
    defaultVersion: '1',
  });

  await app.init();

  // Integration tests must not run the app's wall-clock cron jobs. ScheduleModule
  // (app.module) starts @Cron jobs on init — subscription-expiry (every 30m,
  // writes `subscriptions`) and registration-cleanup (hourly, deletes `users`).
  // Those tables are in the cleanDatabase TRUNCATE set, so a cron firing
  // mid-suite opens a background transaction that races the `TRUNCATE … CASCADE`
  // in beforeEach and intermittently deadlocks (Postgres 40P01) — the failure is
  // non-deterministic because it depends on wall-clock timing. Stop every cron
  // right after init so the test is the only writer for the duration of the run.
  const scheduler = app.get(SchedulerRegistry, { strict: false });
  for (const job of scheduler.getCronJobs().values()) {
    await job.stop();
  }

  return app;
}
