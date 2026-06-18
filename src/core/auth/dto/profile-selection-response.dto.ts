import { ApiProperty } from '@nestjs/swagger';

class SelectableBranchDto {
  @ApiProperty()
  branch_id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  is_main!: boolean;
}

class SelectableJobFunctionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  is_clinical!: boolean;
}

class SelectableProfileDto {
  @ApiProperty()
  profile_id!: string;

  @ApiProperty()
  organization_id!: string;

  @ApiProperty()
  organization_name!: string;

  @ApiProperty()
  role!: string;

  @ApiProperty({
    type: SelectableJobFunctionDto,
    required: false,
    nullable: true,
  })
  job_function!: SelectableJobFunctionDto | null;

  @ApiProperty({ type: [SelectableBranchDto] })
  branches!: SelectableBranchDto[];
}

export class ProfileSelectionResponseDto {
  @ApiProperty({ enum: ['profile_selection'] })
  type!: 'profile_selection';

  @ApiProperty()
  selection_token!: string;

  @ApiProperty({ type: [SelectableProfileDto] })
  profiles!: SelectableProfileDto[];
}
