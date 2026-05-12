export class ProfileResponseDto {
  id!: string;
  organization!: {
    id: string;
    name: string;
    specialties: { id: string; code: string; name: string }[];
    status: string;
  };
  roles!: string[];
  branches!: {
    id: string;
    name: string;
    city: string;
    governorate: string;
    is_main: boolean;
  }[];
}
