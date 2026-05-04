export interface AuthContext {
  userId: string;
  profileId: string;
  organizationId: string;
  activeBranchId?: string;
  roles: string[];
  branchIds: string[];
}
