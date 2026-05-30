import { Module } from '@nestjs/common';
import { SpecialtyCatalogController } from './specialty-catalog.controller.js';
import { SpecialtyCatalogService } from './specialty-catalog.service.js';

@Module({
  controllers: [SpecialtyCatalogController],
  providers: [SpecialtyCatalogService],
  exports: [SpecialtyCatalogService],
})
export class SpecialtyCatalogModule {}
