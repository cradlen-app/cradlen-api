import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EngagementType, ExecutiveTitle } from '@prisma/client';

export class ProfileRoleDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class SpecialtyRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;
}

export class JobFunctionRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  is_clinical!: boolean;
}

export class ProfileOrganizationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: [SpecialtyRefDto] })
  specialties!: SpecialtyRefDto[];

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

  @ApiPropertyOptional({ enum: ExecutiveTitle, nullable: true })
  executive_title!: ExecutiveTitle | null;

  @ApiProperty({ enum: EngagementType })
  engagement_type!: EngagementType;

  @ApiProperty({ type: [ProfileRoleDto] })
  roles!: ProfileRoleDto[];

  @ApiProperty({ type: ProfileOrganizationDto })
  organization!: ProfileOrganizationDto;

  @ApiProperty({ type: [ProfileBranchDto] })
  branches!: ProfileBranchDto[];

  @ApiProperty({ type: [JobFunctionRefDto] })
  job_functions!: JobFunctionRefDto[];

  @ApiProperty({ type: [SpecialtyRefDto] })
  specialties!: SpecialtyRefDto[];
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
