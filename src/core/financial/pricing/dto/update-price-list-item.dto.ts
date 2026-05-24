import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

export class UpdatePriceListItemDto {
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unit_price!: number;
}
