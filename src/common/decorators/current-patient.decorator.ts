import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { PatientAuthContext } from '../interfaces/patient-auth-context.interface.js';

export const CurrentPatient = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PatientAuthContext => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user: PatientAuthContext }>();
    return request.user;
  },
);
