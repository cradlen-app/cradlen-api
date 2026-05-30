import '@infrastructure/monitoring/sentry';
import * as Sentry from '@sentry/nestjs';
import { NestFactory } from '@nestjs/core';
import { VersioningType, ValidationPipe } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { ConfigType } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { ResponseInterceptor } from './common/interceptor/response.interceptor.js';
import { LoggingInterceptor } from './common/interceptor/logging.interceptor.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';
import appConfigDef from './config/app.config';
import { ErrorResponseDto, PaginationMetaDto } from './common/swagger/index.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const appConfig = app.get<ConfigType<typeof appConfigDef>>(appConfigDef.KEY);

  const requestIdMiddleware = new RequestIdMiddleware();
  app.use(requestIdMiddleware.use.bind(requestIdMiddleware));

  app.use(helmet());

  app.enableCors({
    origin: appConfig.cors.origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language'],
    credentials: true,
  });

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
    prefix: appConfig.versioning.prefix,
    defaultVersion: appConfig.versioning.defaultVersion,
  });

  app.use((req: Request, _res: Response, next: NextFunction) => {
    const locale = req.headers['accept-language']
      ?.split(',')[0]
      ?.split('-')[0]
      ?.trim();
    req.headers['x-locale'] =
      locale && appConfig.localisation.supportedLocales.includes(locale)
        ? locale
        : appConfig.localisation.defaultLocale;
    next();
  });

  //http://localhost:3000/docs
  if (appConfig.env !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle(appConfig.name)
      .setVersion(appConfig.versioning.defaultVersion)
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig, {
      extraModels: [ErrorResponseDto, PaginationMetaDto],
    });
    SwaggerModule.setup('docs', app, document);
  }

  // Graceful shutdown: on SIGTERM/SIGINT (container stop, deploy, Ctrl-C) close
  // the Nest app first — this runs onModuleDestroy hooks, e.g.
  // PrismaService.$disconnect, so connections close cleanly instead of being
  // dropped — then drain Sentry's buffered events before exiting. We own the
  // signal handling here (rather than enableShutdownHooks) so Sentry is flushed
  // strictly after the app has closed.
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await app.close();
    } finally {
      await Sentry.close(2000);
      process.exit(0);
    }
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());

  await app.listen(appConfig.port);
}

void bootstrap();
