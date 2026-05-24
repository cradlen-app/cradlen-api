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
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
  ApiVoidResponse,
} from '@common/swagger/index.js';
import { PriceListsService } from './price-lists.service.js';
import { CreatePriceListDto } from './dto/create-price-list.dto.js';
import { CreatePriceListItemDto } from './dto/create-price-list-item.dto.js';
import { UpdatePriceListItemDto } from './dto/update-price-list-item.dto.js';

@ApiTags('Financial — Price Lists')
@ApiBearerAuth()
@Controller('organizations/:orgId/financial/price-lists')
export class PriceListsController {
  constructor(private readonly priceListsService: PriceListsService) {}

  @Get()
  @ApiPaginatedResponse(Object)
  @ApiQuery({ name: 'branch_id', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('branch_id') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.priceListsService.findAll(
      orgId,
      branchId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Post()
  @ApiStandardResponse(Object)
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreatePriceListDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.priceListsService.create(orgId, dto, user);
  }

  @Get(':id/items')
  @ApiStandardResponse(Object)
  findItems(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.priceListsService.findItems(orgId, id);
  }

  @Post(':id/items')
  @ApiStandardResponse(Object)
  addItem(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePriceListItemDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.priceListsService.addItem(orgId, id, dto, user);
  }

  @Patch(':id/items/:itemId')
  @ApiStandardResponse(Object)
  updateItem(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdatePriceListItemDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.priceListsService.updateItem(orgId, id, itemId, dto, user);
  }

  @Delete(':id/items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  removeItem(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.priceListsService.removeItem(orgId, id, itemId, user);
  }
}
