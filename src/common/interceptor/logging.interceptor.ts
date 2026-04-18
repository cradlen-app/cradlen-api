import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { logger } from '../logger/logger.js';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(
    ctx: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const { method, url, headers, ip } = req;
    const start = Date.now();

    const child = logger.child({
      method,
      url,
      ip: (headers['x-forwarded-for'] as string | undefined) ?? ip,
      locale: headers['x-locale'],
      requestId: headers['x-request-id'],
    });

    child.info('incoming request');

    return next.handle().pipe(
      tap({
        next: () => {
          child.info(
            { statusCode: res.statusCode, durationMs: Date.now() - start },
            'request completed',
          );
        },
        error: (err: unknown) => {
          child.error(
            {
              statusCode: res.statusCode,
              durationMs: Date.now() - start,
              err,
            },
            'request failed',
          );
        },
      }),
    );
  }
}
