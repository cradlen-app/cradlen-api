import { IsArray, IsOptional, IsUUID } from 'class-validator';

/**
 * Append a patient's open (PENDING) charges to an existing, already-issued
 * invoice — the post-issue accrual path for a case billed across visits.
 * When charge_ids is omitted, every open charge for the invoice's patient at
 * its branch is pulled in.
 */
export class AppendChargesDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  charge_ids?: string[];
}
