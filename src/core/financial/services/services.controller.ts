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
import { ServicesService } from './services.service.js';
import { CreateServiceDto } from './dto/create-service.dto.js';
import { UpdateServiceDto } from './dto/update-service.dto.js';
import { ServiceResponseDto } from './dto/service-response.dto.js';

@ApiTags('Financial — Services')
@ApiBearerAuth()
@Controller('organizations/:orgId/financial/services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  @ApiPaginatedResponse(ServiceResponseDto)
  findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('service_type') service_type?: string,
    @Query('specialty_id') specialty_id?: string,
    @Query('active') active?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const activeFilter = active !== undefined ? active === 'true' : undefined;
    return this.servicesService.findAll(
      orgId,
      { service_type, specialty_id, active: activeFilter },
      +page,
      +limit,
    );
  }

  @Post()
  @ApiStandardResponse(ServiceResponseDto)
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateServiceDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.servicesService.create(orgId, dto, user);
  }

  @Patch(':id')
  @ApiStandardResponse(ServiceResponseDto)
  update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.servicesService.update(orgId, id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  remove(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.servicesService.remove(orgId, id, user);
  }
}
