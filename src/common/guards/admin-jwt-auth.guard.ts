import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authenticates platform-admin routes against the `admin-jwt` strategy. Admin
 * routes mark themselves `@Public()` to bypass the global staff JwtAuthGuard
 * (and SubscriptionGuard), then opt into this guard explicitly.
 */
@Injectable()
export class AdminJwtAuthGuard extends AuthGuard('admin-jwt') {}
