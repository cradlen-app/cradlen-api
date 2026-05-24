import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateProviderPriceOverrideDto } from './create-provider-price-override.dto.js';

export class UpdateProviderPriceOverrideDto extends PartialType(
  OmitType(CreateProviderPriceOverrideDto, [
    'service_id',
    'branch_id',
  ] as const),
) {}
