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
import { PriceListsService } from './price-lists.service.js';
import { CreatePriceListDto } from './dto/create-price-list.dto.js';
import { CreatePriceListItemDto } from './dto/create-price-list-item.dto.js';
import { UpdatePriceListItemDto } from './dto/update-price-list-item.dto.js';
import { ListPriceListsQueryDto } from './dto/list-price-lists-query.dto.js';

@ApiTags('Financial — Price Lists')
@ApiBearerAuth()
@Controller('organizations/:orgId/financial/price-lists')
export class PriceListsController {
  constructor(private readonly priceListsService: PriceListsService) {}

  @Get()
  @ApiPaginatedResponse(Object)
  findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ListPriceListsQueryDto,
  ) {
    return this.priceListsService.findAll(
      orgId,
      query.branch_id,
      query.page,
      query.limit,
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
