export class ProfileDetailResponseDto {
  id!: string;
  first_name!: string;
  last_name!: string;
  email!: string | null;
  phone_number!: string | null;
  job_title!: string | null;
  specialty!: string | null;
  is_clinical!: boolean;
  roles!: string[];
  account!: { id: string; name: string };
  branches!: {
    id: string;
    name: string;
    city: string;
    governorate: string;
    is_main: boolean;
  }[];
}
