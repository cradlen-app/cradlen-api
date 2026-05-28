export interface InvitationAcceptedEventInit {
  invitationId: string;
  inviterId: string;
  inviteeName: string;
  organizationId: string;
  branchId: string | null;
}

export class InvitationAcceptedEvent implements InvitationAcceptedEventInit {
  readonly invitationId: string;
  readonly inviterId: string;
  readonly inviteeName: string;
  readonly organizationId: string;
  readonly branchId: string | null;

  constructor(init: InvitationAcceptedEventInit) {
    this.invitationId = init.invitationId;
    this.inviterId = init.inviterId;
    this.inviteeName = init.inviteeName;
    this.organizationId = init.organizationId;
    this.branchId = init.branchId;
  }
}
