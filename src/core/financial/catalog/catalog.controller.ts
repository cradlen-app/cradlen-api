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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
  ApiVoidResponse,
} from '@common/swagger/index.js';
import { CatalogService } from './catalog.service.js';
import { CreateServiceDto } from './dto/create-service.dto.js';
import { UpdateServiceDto } from './dto/update-service.dto.js';
import { ServiceResponseDto } from './dto/service-response.dto.js';
import { ListServicesQueryDto } from './dto/list-services-query.dto.js';

@ApiTags('Financial — Catalog')
@ApiBearerAuth()
@Controller('organizations/:orgId/financial/catalog/services')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  @ApiPaginatedResponse(ServiceResponseDto)
  findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ListServicesQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    const activeFilter =
      query.active !== undefined ? query.active === 'true' : undefined;
    return this.catalogService.findAll(
      orgId,
      {
        service_type: query.service_type,
        specialty_id: query.specialty_id,
        category_id: query.category_id,
        active: activeFilter,
      },
      query.page ?? 1,
      query.limit ?? 20,
      user,
    );
  }

  @Get(':id')
  @ApiStandardResponse(ServiceResponseDto)
  findOne(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.catalogService.getOne(orgId, id, user);
  }

  @Post()
  @ApiStandardResponse(ServiceResponseDto)
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateServiceDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.catalogService.create(orgId, dto, user);
  }

  @Post(':id/activate')
  @ApiStandardResponse(ServiceResponseDto)
  activate(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.catalogService.activate(orgId, id, user);
  }

  @Post(':id/deactivate')
  @ApiStandardResponse(ServiceResponseDto)
  deactivate(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.catalogService.deactivate(orgId, id, user);
  }

  @Patch(':id')
  @ApiStandardResponse(ServiceResponseDto)
  update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.catalogService.update(orgId, id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  remove(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.catalogService.remove(orgId, id, user);
  }
}
