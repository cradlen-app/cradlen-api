import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { ResponseInterceptor } from './common/interceptor/response.interceptor.js';
import { LoggingInterceptor } from './common/interceptor/logging.interceptor.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import type { AppConfig } from './config/app.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const appConfig = configService.get<AppConfig>('app')!;

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new ResponseInterceptor(),
  );

  app.enableVersioning({
    type: VersioningType.URI,
    prefix: appConfig.versioning.prefix,
    defaultVersion: appConfig.versioning.defaultVersion,
  });

  app.use(
    (
      req: { headers: Record<string, string> },
      _res: unknown,
      next: () => void,
    ) => {
      const locale = req.headers['accept-language']
        ?.split(',')[0]
        ?.split('-')[0];
      req.headers['x-locale'] =
        appConfig.localisation.supportedLocales.includes(locale ?? '')
          ? locale
          : appConfig.localisation.defaultLocale;
      next();
    },
  );

  await app.listen(appConfig.port);
}

bootstrap();
