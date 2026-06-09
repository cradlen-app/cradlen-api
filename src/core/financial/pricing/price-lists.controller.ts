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
  Put,
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
import { UpdatePriceListDto } from './dto/update-price-list.dto.js';
import { ListPriceListsQueryDto } from './dto/list-price-lists-query.dto.js';
import { SetPriceListItemsDto } from './dto/set-price-list-items.dto.js';

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
    @CurrentUser() user: AuthContext,
  ) {
    return this.priceListsService.findAll(
      orgId,
      query.branch_id,
      query.page,
      query.limit,
      user,
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

  @Patch(':id')
  @ApiStandardResponse(Object)
  update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePriceListDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.priceListsService.update(orgId, id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  remove(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.priceListsService.remove(orgId, id, user);
  }

  @Get(':id')
  @ApiStandardResponse(Object)
  getOne(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.priceListsService.getOne(orgId, id, user);
  }

  @Post(':id/set-default')
  @ApiStandardResponse(Object)
  setDefault(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.priceListsService.setDefault(orgId, id, user);
  }

  @Post(':id/activate')
  @ApiStandardResponse(Object)
  activate(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.priceListsService.activate(orgId, id, user);
  }

  @Post(':id/deactivate')
  @ApiStandardResponse(Object)
  deactivate(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.priceListsService.deactivate(orgId, id, user);
  }

  @Get(':id/items')
  @ApiStandardResponse(Object)
  findItems(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.priceListsService.findItems(orgId, id, user);
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

  @Put(':id/items')
  @ApiStandardResponse(Object)
  setItems(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPriceListItemsDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.priceListsService.setItems(orgId, id, dto, user);
  }

  @Get(':id/items/:itemId')
  @ApiStandardResponse(Object)
  getItem(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.priceListsService.getItem(orgId, id, itemId, user);
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
