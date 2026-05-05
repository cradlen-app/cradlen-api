export class InvitationAcceptedEvent {
  invitationId!: string;
  inviterId!: string;
  inviteeName!: string;
  organizationId!: string;
  branchId!: string | null;
}
