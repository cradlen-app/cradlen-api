export class ProfileResponseDto {
  id!: string;
  account!: {
    id: string;
    name: string;
    specialities: string[];
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
