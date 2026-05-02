import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SwitchBranchDto {
  @ApiProperty({ description: 'ID of the branch to switch to' })
  @IsUUID()
  branch_id!: string;
}
