import { ApiProperty } from '@nestjs/swagger';

class SelectableBranchDto {
  @ApiProperty()
  branch_id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  is_main!: boolean;
}

class SelectableProfileDto {
  @ApiProperty()
  profile_id!: string;

  @ApiProperty()
  organization_id!: string;

  @ApiProperty()
  organization_name!: string;

  @ApiProperty({ type: [String] })
  roles!: string[];

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
