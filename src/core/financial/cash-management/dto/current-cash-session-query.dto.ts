import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CurrentCashSessionQueryDto {
  @ApiProperty({ description: 'Branch whose open drawer to look up.' })
  @IsUUID('4')
  branch_id!: string;
}
