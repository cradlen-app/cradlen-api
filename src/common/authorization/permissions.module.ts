import { Global, Module } from '@nestjs/common';
import { PermissionCatalog } from './permission-catalog.js';
import { PermissionGuard } from '@common/guards/permission.guard.js';

/**
 * Global so any controller can `@UseGuards(PermissionGuard)` +
 * `@RequirePermission(id)` without importing anything in its own module. The
 * catalog is stateless and the guard is opt-in (no-op without the decorator),
 * so making it global has no side effects on un-annotated routes.
 */
@Global()
@Module({
  providers: [PermissionCatalog, PermissionGuard],
  exports: [PermissionCatalog, PermissionGuard],
})
export class PermissionsModule {}
