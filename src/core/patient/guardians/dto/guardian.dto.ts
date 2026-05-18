import { ApiProperty } from '@nestjs/swagger';

export class GuardianSearchResultDto {
  @ApiProperty() id!: string;
  @ApiProperty() full_name!: string;
  @ApiProperty({ required: false, nullable: true }) national_id!: string | null;
  @ApiProperty({ required: false, nullable: true }) phone_number!:
    | string
    | null;
}
