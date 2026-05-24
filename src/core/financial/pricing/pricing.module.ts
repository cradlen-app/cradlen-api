import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { PriceListsController } from './price-lists.controller.js';
import { ProviderServicesController } from './provider-services.controller.js';
import { ResolvePriceController } from './financial-resolve-price.controller.js';
import { PriceListsService } from './price-lists.service.js';
import { ProviderServicesService } from './provider-services.service.js';
import { PricingResolverService } from './pricing-resolver.service.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [
    PriceListsController,
    ProviderServicesController,
    ResolvePriceController,
  ],
  providers: [
    PriceListsService,
    ProviderServicesService,
    PricingResolverService,
  ],
  exports: [PricingResolverService],
})
export class PricingModule {}
