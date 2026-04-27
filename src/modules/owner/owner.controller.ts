import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ApiStandardResponse } from '../../common/swagger/index.js';
import { OwnerService } from './owner.service.js';
import { UpdateOwnerProfileDto } from './dto/update-owner-profile.dto.js';
import { UpdateOwnerOrganizationDto } from './dto/update-owner-organization.dto.js';
import { OwnerResponseDto } from './dto/owner-response.dto.js';
import { ParseUUIDPipe } from '@nestjs/common';

@ApiTags('Owner')
@ApiBearerAuth()
@Controller('owner')
export class OwnerController {
  constructor(private readonly ownerService: OwnerService) {}

  @Get()
  @ApiOperation({ summary: 'Get owner profile and organization (owner only)' })
  @ApiStandardResponse(OwnerResponseDto)
  getOwner(
    @CurrentUser() user: User,
    @Query('organization_id', ParseUUIDPipe) organizationId: string,
  ) {
    return this.ownerService.getOwner(user.id, organizationId);
  }

  @Patch('profile')
  @ApiOperation({
    summary:
      'Update owner personal info, clinical profile, and staff details (owner only)',
  })
  @ApiStandardResponse(OwnerResponseDto)
  updateOwnerProfile(
    @CurrentUser() user: User,
    @Query('organization_id', ParseUUIDPipe) organizationId: string,
    @Body() dto: UpdateOwnerProfileDto,
  ) {
    return this.ownerService.updateOwnerProfile(user.id, organizationId, dto);
  }

  @Patch('organization')
  @ApiOperation({ summary: 'Update organization info (owner only)' })
  @ApiStandardResponse(OwnerResponseDto)
  updateOwnerOrganization(
    @CurrentUser() user: User,
    @Query('organization_id', ParseUUIDPipe) organizationId: string,
    @Body() dto: UpdateOwnerOrganizationDto,
  ) {
    return this.ownerService.updateOwnerOrganization(
      user.id,
      organizationId,
      dto,
    );
  }
}
