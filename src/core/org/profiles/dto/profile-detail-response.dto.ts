import type { EngagementType, ExecutiveTitle } from '@prisma/client';

export class ProfileDetailResponseDto {
  id!: string;
  first_name!: string;
  last_name!: string;
  email!: string | null;
  phone_number!: string | null;
  executive_title!: ExecutiveTitle | null;
  engagement_type!: EngagementType;
  roles!: string[];
  organization!: { id: string; name: string };
  branches!: {
    id: string;
    name: string;
    city: string;
    governorate: string;
    is_main: boolean;
  }[];
  job_functions!: {
    id: string;
    code: string;
    name: string;
    is_clinical: boolean;
  }[];
  specialties!: { id: string; code: string; name: string }[];
}
