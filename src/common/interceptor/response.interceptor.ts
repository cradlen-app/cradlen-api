import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { isPaginatedPayload } from '../dto/api-response.dto.js';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(
    _ctx: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((value: unknown) => {
        if (isPaginatedPayload(value)) {
          return { data: value.items, meta: value.meta };
        }
        return { data: value ?? null, meta: {} };
      }),
    );
  }
}
