// Public boundary for the invitations module. Other core modules (e.g.
// notifications) consume invitation domain events through this barrel rather
// than reaching into internal files.

export {
  InvitationAcceptedEvent,
  type InvitationAcceptedEventInit,
} from './events/invitation-accepted.event.js';
export {
  InvitationDeclinedEvent,
  type InvitationDeclinedEventInit,
} from './events/invitation-declined.event.js';
