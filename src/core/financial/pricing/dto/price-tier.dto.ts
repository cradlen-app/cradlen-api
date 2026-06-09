import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, Min } from 'class-validator';

/** A quantity-break tier: from `min_quantity` units, each unit costs `unit_price`. */
export class PriceTierDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  min_quantity!: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unit_price!: number;
}
