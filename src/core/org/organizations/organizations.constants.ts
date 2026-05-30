/**
 * The role granted to a founder when an organization is created. Looked up by
 * Role.code; a missing row is an infrastructure (seed) failure, not a 404.
 */
export const OWNER_ROLE_CODE = 'OWNER';

/** SubscriptionPlan.plan value for the free-trial plan attached at creation. */
export const FREE_TRIAL_PLAN = 'free_trial';
