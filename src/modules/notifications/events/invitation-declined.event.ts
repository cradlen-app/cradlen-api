export class InvitationDeclinedEvent {
  invitationId!: string;
  inviterId!: string;
  inviteeName!: string;
  organizationId!: string;
  branchId!: string | null;
}
