import '@infrastructure/monitoring/sentry';
import { NestFactory } from '@nestjs/core';
import { VersioningType, ValidationPipe } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { ResponseInterceptor } from './common/interceptor/response.interceptor.js';
import { LoggingInterceptor } from './common/interceptor/logging.interceptor.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';
import type { AppConfig } from './config/app.config';
import { ErrorResponseDto, PaginationMetaDto } from './common/swagger/index.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const appConfig = configService.get<AppConfig>('app');
  if (!appConfig) throw new Error('App configuration not loaded');

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

  await app.listen(appConfig.port);
}

void bootstrap();
