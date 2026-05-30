/**
 * Branch domain events catalog.
 *
 * Single source of truth for event names emitted by the branches module.
 * Consumers subscribe via `@OnEvent('<name>')` from `@nestjs/event-emitter`.
 */

export const BRANCH_EVENTS = {
  created: 'branch.created',
  deleted: 'branch.deleted',
} as const;

export interface BranchChangedPayload {
  id: string;
  organization_id: string;
  is_main: boolean;
  /** True when deleting this branch tore down the whole organization. */
  organization_deleted?: boolean;
}
