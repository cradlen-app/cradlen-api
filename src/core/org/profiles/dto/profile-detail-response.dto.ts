import type { EngagementType, ExecutiveTitle } from '@prisma/client';

export class ProfileDetailResponseDto {
  id!: string;
  first_name!: string;
  last_name!: string;
  email!: string | null;
  phone_number!: string | null;
  executive_title!: ExecutiveTitle | null;
  professional_title!: string | null;
  engagement_type!: EngagementType;
  role!: string;
  organization!: { id: string; name: string };
  branches!: {
    id: string;
    name: string;
    city: string;
    governorate: string;
    is_main: boolean;
  }[];
  job_function!: {
    id: string;
    code: string;
    name: string;
    is_clinical: boolean;
  } | null;
  specialty!: { id: string; code: string; name: string } | null;
  subspecialties!: {
    id: string;
    code: string;
    name: string;
    specialty_code: string;
  }[];
  /** Short-lived presigned GET URL for the avatar, or null when none. */
  profile_image_url!: string | null;
}
