import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
  ApiVoidResponse,
} from '@common/swagger/index.js';
import { PermissionGuard } from '@common/guards/permission.guard.js';
import { RequirePermission } from '@common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '@common/authorization/permission-matrix.js';
import { CatalogCategoryService } from './category.service.js';
import { CreateServiceCategoryDto } from './dto/create-service-category.dto.js';
import { UpdateServiceCategoryDto } from './dto/update-service-category.dto.js';
import { ServiceCategoryResponseDto } from './dto/service-category-response.dto.js';
import { ListServiceCategoriesQueryDto } from './dto/list-service-categories-query.dto.js';

@ApiTags('Financial — Catalog')
@ApiBearerAuth()
@Controller('organizations/:orgId/financial/catalog/categories')
// Owner-only catalog administration (matches `financial.manageCatalog`). Only
// mutations are gated; the GET read stays open for billing staff.
@UseGuards(PermissionGuard)
export class CategoryController {
  constructor(private readonly categoryService: CatalogCategoryService) {}

  @Get()
  @ApiPaginatedResponse(ServiceCategoryResponseDto)
  findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ListServiceCategoriesQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    const activeFilter =
      query.active !== undefined ? query.active === 'true' : undefined;
    return this.categoryService.findAll(
      orgId,
      { active: activeFilter },
      query.page ?? 1,
      query.limit ?? 20,
      user,
    );
  }

  @Post()
  @RequirePermission(PERMISSIONS.financialManageCatalog)
  @ApiStandardResponse(ServiceCategoryResponseDto)
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateServiceCategoryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.categoryService.create(orgId, dto, user);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.financialManageCatalog)
  @ApiStandardResponse(ServiceCategoryResponseDto)
  update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceCategoryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.categoryService.update(orgId, id, dto, user);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.financialManageCatalog)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  remove(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.categoryService.remove(orgId, id, user);
  }
}
