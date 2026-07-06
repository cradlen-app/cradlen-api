/**
 * Compliance domain-event names. Published through `EventBus` for non-critical
 * fan-out only (e.g. suppressing communications when COMMUNICATIONS consent is
 * withdrawn). The authoritative consent row is written inline first
 * (persist-then-publish) — EventBus swallows subscriber errors, so it must never
 * carry a must-not-drop side effect.
 */
export const COMPLIANCE_EVENTS = {
  CONSENT_GRANTED: 'compliance.consent.granted',
  CONSENT_WITHDRAWN: 'compliance.consent.withdrawn',
} as const;

export interface ConsentEventPayload {
  consentId: string;
  patientId: string;
  organizationId: string;
  type: string;
  capturedById: string;
}
