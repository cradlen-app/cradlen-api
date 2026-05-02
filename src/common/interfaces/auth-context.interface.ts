export interface AuthContext {
  userId: string;
  profileId: string;
  accountId: string;
  activeBranchId?: string;
  roles: string[];
  branchIds: string[];
}
