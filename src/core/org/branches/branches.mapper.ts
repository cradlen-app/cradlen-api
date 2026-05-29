import type { Branch } from '@prisma/client';
import type { BranchResponseDto } from './dto/branch-response.dto.js';

/**
 * Maps a raw Branch row to the public response shape, dropping internal
 * columns (`is_deleted`, `deleted_at`, `organization_id`).
 */
export function toBranchResponse(branch: Branch): BranchResponseDto {
  return {
    id: branch.id,
    name: branch.name,
    address: branch.address,
    city: branch.city,
    governorate: branch.governorate,
    country: branch.country,
    is_main: branch.is_main,
    status: branch.status,
    created_at: branch.created_at,
    updated_at: branch.updated_at,
  };
}

export function toBranchResponseList(branches: Branch[]): BranchResponseDto[] {
  return branches.map(toBranchResponse);
}
