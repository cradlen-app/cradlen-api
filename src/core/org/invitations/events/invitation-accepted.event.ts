export interface InvitationAcceptedEventInit {
  invitationId: string;
  /** Profile of the inviter within the invitation's organization. */
  recipientProfileId: string;
  inviteeName: string;
  organizationId: string;
  branchId: string | null;
}

export class InvitationAcceptedEvent implements InvitationAcceptedEventInit {
  readonly invitationId: string;
  readonly recipientProfileId: string;
  readonly inviteeName: string;
  readonly organizationId: string;
  readonly branchId: string | null;

  constructor(init: InvitationAcceptedEventInit) {
    this.invitationId = init.invitationId;
    this.recipientProfileId = init.recipientProfileId;
    this.inviteeName = init.inviteeName;
    this.organizationId = init.organizationId;
    this.branchId = init.branchId;
  }
}
