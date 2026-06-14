import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ERROR_CODES } from '@common/constant/error-codes.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { SKIP_SUBSCRIPTION_CHECK } from './skip-subscription-check.decorator.js';

/**
 * Denies mutating (write) requests for an organization whose subscription is no
 * longer active (not TRIAL/ACTIVE, or past its end date). Reads (GET/HEAD/
 * OPTIONS), unauthenticated/public routes (no org context), and routes marked
 * `@SkipSubscriptionCheck()` (the billing surfaces) always pass — so the owner
 * can still view data and pay to renew.
 *
 * Registered globally AFTER `JwtAuthGuard` so `request.user` is populated.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  private static readonly SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_SUBSCRIPTION_CHECK,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthContext }>();

    if (SubscriptionGuard.SAFE_METHODS.has(request.method)) return true;

    // Gate the organization actually being mutated: prefer the route's :orgId
    // over the caller's token org, so the subscription of the *target* org is
    // enforced (the token org and route org can differ). Fall back to the token
    // org for routes that carry no :orgId param.
    const params = request.params as Record<string, string | undefined>;
    const organizationId = params?.orgId ?? request.user?.organizationId;
    if (!organizationId) return true; // public / unauthenticated route

    const active = await this.subscriptionsService.isOrgActive(organizationId);
    if (!active) {
      throw new ForbiddenException({
        code: ERROR_CODES.SUBSCRIPTION_EXPIRED,
        message: 'Your subscription is not active. Renew to continue.',
        details: {},
      });
    }
    return true;
  }
}
