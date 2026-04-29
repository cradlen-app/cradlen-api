import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ApiStandardResponse } from '../../common/swagger/index.js';
import { OwnerService } from './owner.service.js';
import { CreateOwnerOrganizationDto } from './dto/create-owner-organization.dto.js';
import { UpdateOwnerProfileDto } from './dto/update-owner-profile.dto.js';
import { UpdateOwnerOrganizationDto } from './dto/update-owner-organization.dto.js';
import { CreateOwnerBranchDto } from './dto/create-owner-branch.dto.js';
import { UpdateOwnerBranchDto } from './dto/update-owner-branch.dto.js';
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

  @Post('organizations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create organization and main branch (owner)' })
  @ApiStandardResponse(Object)
  createOrganization(
    @CurrentUser() user: User,
    @Body() dto: CreateOwnerOrganizationDto,
  ) {
    return this.ownerService.createOrganization(user.id, dto);
  }

  @Patch('organizations/:organization_id')
  @ApiOperation({ summary: 'Update organization info (owner only)' })
  @ApiStandardResponse(OwnerResponseDto)
  updateOrganizationById(
    @CurrentUser() user: User,
    @Param('organization_id', ParseUUIDPipe) organizationId: string,
    @Body() dto: UpdateOwnerOrganizationDto,
  ) {
    return this.ownerService.updateOwnerOrganization(
      user.id,
      organizationId,
      dto,
    );
  }

  @Delete('organizations/:organization_id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete organization (owner only)' })
  @ApiStandardResponse(Object)
  deleteOrganization(
    @CurrentUser() user: User,
    @Param('organization_id', ParseUUIDPipe) organizationId: string,
  ) {
    return this.ownerService.deleteOrganization(user.id, organizationId);
  }

  @Post('branches')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create branch under an organization (owner only)' })
  @ApiStandardResponse(Object)
  createBranch(@CurrentUser() user: User, @Body() dto: CreateOwnerBranchDto) {
    return this.ownerService.createBranch(user.id, dto);
  }

  @Patch('branches/:branch_id')
  @ApiOperation({ summary: 'Update branch (owner only)' })
  @ApiStandardResponse(Object)
  updateBranch(
    @CurrentUser() user: User,
    @Param('branch_id', ParseUUIDPipe) branchId: string,
    @Query('organization_id', ParseUUIDPipe) organizationId: string,
    @Body() dto: UpdateOwnerBranchDto,
  ) {
    return this.ownerService.updateBranch(
      user.id,
      organizationId,
      branchId,
      dto,
    );
  }

  @Delete('branches/:branch_id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete branch (owner only)' })
  @ApiStandardResponse(Object)
  deleteBranch(
    @CurrentUser() user: User,
    @Param('branch_id', ParseUUIDPipe) branchId: string,
    @Query('organization_id', ParseUUIDPipe) organizationId: string,
  ) {
    return this.ownerService.deleteBranch(user.id, organizationId, branchId);
  }
}
