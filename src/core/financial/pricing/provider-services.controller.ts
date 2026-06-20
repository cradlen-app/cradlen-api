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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { ApiStandardResponse, ApiVoidResponse } from '@common/swagger/index.js';
import { ProviderServicesService } from './provider-services.service.js';
import { CreateProviderServiceDto } from './dto/create-provider-service.dto.js';
import { CreateProviderServicesDto } from './dto/create-provider-services.dto.js';
import { CreateProviderPriceOverrideDto } from './dto/create-provider-price-override.dto.js';
import { UpdateProviderPriceOverrideDto } from './dto/update-provider-price-override.dto.js';

@ApiTags('Financial — Provider Services')
@ApiBearerAuth()
@Controller('organizations/:orgId/providers/:profileId')
export class ProviderServicesController {
  constructor(
    private readonly providerServicesService: ProviderServicesService,
  ) {}

  @Get('services')
  @ApiStandardResponse(Object)
  findServices(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.providerServicesService.findProviderServices(
      orgId,
      profileId,
      user,
    );
  }

  @Get('services/:serviceId')
  @ApiStandardResponse(Object)
  getService(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.providerServicesService.getProviderService(
      orgId,
      profileId,
      serviceId,
      user,
    );
  }

  @Post('services/:serviceId/activate')
  @ApiStandardResponse(Object)
  activateService(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.providerServicesService.setServiceActive(
      orgId,
      profileId,
      serviceId,
      true,
      user,
    );
  }

  @Post('services/:serviceId/deactivate')
  @ApiStandardResponse(Object)
  deactivateService(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.providerServicesService.setServiceActive(
      orgId,
      profileId,
      serviceId,
      false,
      user,
    );
  }

  @Post('services')
  @ApiStandardResponse(Object)
  authorizeService(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: CreateProviderServiceDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.providerServicesService.authorizeService(
      orgId,
      profileId,
      dto,
      user,
    );
  }

  @Post('services/batch')
  @ApiStandardResponse(Object)
  authorizeServices(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: CreateProviderServicesDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.providerServicesService.authorizeServices(
      orgId,
      profileId,
      dto,
      user,
    );
  }

  @Delete('services/:serviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  revokeService(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.providerServicesService.revokeService(
      orgId,
      profileId,
      serviceId,
      user,
    );
  }

  @Get('price-overrides')
  @ApiStandardResponse(Object)
  findOverrides(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.providerServicesService.findPriceOverrides(
      orgId,
      profileId,
      user,
    );
  }

  @Get('price-overrides/:id')
  @ApiStandardResponse(Object)
  getOverride(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.providerServicesService.getPriceOverride(
      orgId,
      profileId,
      id,
      user,
    );
  }

  @Post('price-overrides/:id/activate')
  @ApiStandardResponse(Object)
  activateOverride(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.providerServicesService.setOverrideActive(
      orgId,
      profileId,
      id,
      true,
      user,
    );
  }

  @Post('price-overrides/:id/deactivate')
  @ApiStandardResponse(Object)
  deactivateOverride(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.providerServicesService.setOverrideActive(
      orgId,
      profileId,
      id,
      false,
      user,
    );
  }

  @Post('price-overrides')
  @ApiStandardResponse(Object)
  createOverride(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: CreateProviderPriceOverrideDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.providerServicesService.createPriceOverride(
      orgId,
      profileId,
      dto,
      user,
    );
  }

  @Patch('price-overrides/:id')
  @ApiStandardResponse(Object)
  updateOverride(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProviderPriceOverrideDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.providerServicesService.updatePriceOverride(
      orgId,
      profileId,
      id,
      dto,
      user,
    );
  }

  @Delete('price-overrides/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  removeOverride(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.providerServicesService.removePriceOverride(
      orgId,
      profileId,
      id,
      user,
    );
  }
}
