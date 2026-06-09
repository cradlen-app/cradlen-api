import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ListRefundsQueryDto {
  @ApiProperty()
  @IsUUID('4')
  invoice_id!: string;
}
