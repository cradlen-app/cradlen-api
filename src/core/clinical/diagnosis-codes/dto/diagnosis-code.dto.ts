import { ApiProperty } from '@nestjs/swagger';

export class DiagnosisCodeDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'N80.0' })
  code!: string;

  @ApiProperty({ example: 'Endometriosis of the uterus' })
  description!: string;

  @ApiProperty({ nullable: true, example: 'Gynecology' })
  chapter!: string | null;

  @ApiProperty({ nullable: true, example: 'OBGYN' })
  specialty_code!: string | null;

  @ApiProperty({ example: true })
  billable!: boolean;
}
