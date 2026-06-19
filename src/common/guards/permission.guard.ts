import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import type { CatalogPermissionId } from '@common/authorization/permission-matrix.js';
import { PermissionCatalog } from '@common/authorization/permission-catalog.js';
import { REQUIRE_PERMISSION_KEY } from '@common/decorators/require-permission.decorator.js';

/**
 * Method/controller guard for capability gates declared with
 * `@RequirePermission(id)`. Runs after the global `JwtAuthGuard` (so
 * `request.user` is populated) and answers the coarse "may this persona reach
 * this surface" question using the shared `PermissionCatalog`.
 *
 * Routes without `@RequirePermission` are allowed through (the guard is opt-in).
 * Branch/ownership scoping remains the service layer's job.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly catalog: PermissionCatalog,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<
      CatalogPermissionId | undefined
    >(REQUIRE_PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    if (!required) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthContext }>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    if (!this.catalog.check(required, user)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
