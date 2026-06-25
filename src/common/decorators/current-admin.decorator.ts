import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AdminAuthContext } from '../interfaces/admin-auth-context.interface.js';

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminAuthContext => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user: AdminAuthContext }>();
    return request.user;
  },
);
