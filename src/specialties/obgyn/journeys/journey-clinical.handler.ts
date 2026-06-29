import { AuthContext } from '@common/interfaces/auth-context.interface';

/**
 * Contract every journey clinical surface implements. The generic dispatcher
 * (`JourneyClinicalController`) resolves the visit's journey → care path code
 * and delegates GET/PATCH to the handler registered for that code. Each surface
 * owns its envelope shape + namespace demux + revisions; the dispatcher only
 * routes. Keeps the FE on a single generic endpoint
 * (`/v1/visits/:visitId/journeys/:journeyId/clinical`) across all surfaces.
 */
export interface JourneyClinicalHandler {
  get(visitId: string, journeyId: string, user: AuthContext): Promise<unknown>;
  patch(
    visitId: string,
    journeyId: string,
    body: Record<string, unknown>,
    user: AuthContext,
  ): Promise<unknown>;
}
