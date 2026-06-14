import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
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
  return app;
}
