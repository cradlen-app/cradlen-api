import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authenticates patient-facing routes against the `patient-jwt` strategy.
 * Patient routes mark themselves `@Public()` to bypass the global staff
 * JwtAuthGuard, then opt into this guard explicitly.
 */
@Injectable()
export class PatientJwtAuthGuard extends AuthGuard('patient-jwt') {}
