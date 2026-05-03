import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProfileRoleDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class ProfileOrganizationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: [String] })
  specialities!: string[];

  @ApiProperty()
  status!: string;
}

export class ProfileBranchDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  address!: string;

  @ApiProperty()
  city!: string;

  @ApiProperty()
  governorate!: string;

  @ApiPropertyOptional({ nullable: true })
  country!: string | null;

  @ApiProperty()
  is_main!: boolean;
}

export class StaffProfileDto {
  @ApiProperty()
  staff_id!: string;

  @ApiPropertyOptional({ nullable: true })
  job_title!: string | null;

  @ApiPropertyOptional({ nullable: true })
  specialty!: string | null;

  @ApiProperty()
  is_clinical!: boolean;

  @ApiProperty({ type: [ProfileRoleDto] })
  roles!: ProfileRoleDto[];

  @ApiProperty({ type: ProfileOrganizationDto })
  organization!: ProfileOrganizationDto;

  @ApiProperty({ type: [ProfileBranchDto] })
  branches!: ProfileBranchDto[];
}

export class MeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  first_name!: string;

  @ApiProperty()
  last_name!: string;

  @ApiProperty()
  email!: string;

  @ApiPropertyOptional({ nullable: true })
  phone_number!: string | null;

  @ApiProperty()
  is_active!: boolean;

  @ApiPropertyOptional({ nullable: true })
  verified_at!: Date | null;

  @ApiProperty()
  created_at!: Date;

  @ApiProperty({ type: [StaffProfileDto] })
  profiles!: StaffProfileDto[];
}
