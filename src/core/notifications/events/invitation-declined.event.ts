export interface InvitationDeclinedEventInit {
  invitationId: string;
  inviterId: string;
  inviteeName: string;
  organizationId: string;
  branchId: string | null;
}

export class InvitationDeclinedEvent implements InvitationDeclinedEventInit {
  readonly invitationId: string;
  readonly inviterId: string;
  readonly inviteeName: string;
  readonly organizationId: string;
  readonly branchId: string | null;

  constructor(init: InvitationDeclinedEventInit) {
    this.invitationId = init.invitationId;
    this.inviterId = init.inviterId;
    this.inviteeName = init.inviteeName;
    this.organizationId = init.organizationId;
    this.branchId = init.branchId;
  }
}
