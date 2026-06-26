/**
 * Domain-event names for the organization lifecycle. Published via `EventBus`;
 * downstream consumers (admin notifications, analytics) subscribe with `@OnEvent`.
 */
export const ORGANIZATION_EVENTS = {
  created: 'organization.created',
  trialStarted: 'organization.trial_started',
} as const;

export interface OrganizationCreatedEvent {
  organization_id: string;
  organization_name: string;
}

export interface OrganizationTrialStartedEvent {
  organization_id: string;
  organization_name: string;
  trial_ends_at: string;
}
