export interface AuthContext {
  userId: string;
  profileId: string;
  organizationId: string;
  activeBranchId?: string;
  role: string;
  jobFunction: string | null;
  branchIds: string[];
}
