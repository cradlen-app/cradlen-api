import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { CategoryController } from './category.controller.js';
import { CatalogCategoryService } from './category.service.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [CatalogController, CategoryController],
  providers: [CatalogService, CatalogCategoryService],
  exports: [CatalogService],
})
export class CatalogModule {}
