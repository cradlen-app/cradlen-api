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

    // Enforce the subscription of the org the caller actually belongs to. A
    // staff access token is scoped to a single organization, so a route :orgId
    // that differs from the token org is a cross-tenant attempt — the
    // service-layer authz rejects it. Don't probe a foreign org's subscription
    // here (that would both mis-gate and leak another org's billing state);
    // defer to downstream authz instead.
    const params = request.params as Record<string, string | undefined>;
    const routeOrgId = params?.orgId;
    const tokenOrgId = request.user?.organizationId;
    if (routeOrgId && tokenOrgId && routeOrgId !== tokenOrgId) {
      return true;
    }
    const organizationId = routeOrgId ?? tokenOrgId;
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
