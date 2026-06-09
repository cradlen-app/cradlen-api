import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { CreatePriceListItemDto } from './create-price-list-item.dto.js';

/** Bulk replace: the price list's items become exactly this set (keyed by service_id). */
export class SetPriceListItemsDto {
  @ApiProperty({ type: [CreatePriceListItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePriceListItemDto)
  items!: CreatePriceListItemDto[];
}
