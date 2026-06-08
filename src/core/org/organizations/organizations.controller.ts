import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import {
  ApiStandardArrayResponse,
  ApiStandardResponse,
  ApiVoidResponse,
} from '@common/swagger/index.js';
import { OrganizationsService } from './organizations.service.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import {
  ConfirmOrganizationImageDto,
  OrganizationImageUploadDto,
  OrganizationImageUploadUrlDto,
} from './dto/organization-image.dto.js';
import {
  CreateOrganizationResultDto,
  OrganizationResponseDto,
  SpecialtySummaryDto,
} from './dto/organization-response.dto.js';

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new organization' })
  @ApiStandardResponse(CreateOrganizationResultDto)
  createOrganization(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.organizationsService.createOrganization(user.userId, dto);
  }

  @Get(':organizationId/specialties')
  @ApiOperation({
    summary: "List the organization's enabled specialties",
    description:
      "Returns only the specialties the organization has configured (OrganizationSpecialty rows). Used by the book-visit form's specialty dropdown. Available to any active profile in the organization.",
  })
  @ApiParam({ name: 'organizationId', format: 'uuid' })
  @ApiStandardArrayResponse(SpecialtySummaryDto)
  listOrganizationSpecialties(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    return this.organizationsService.listOrganizationSpecialties(
      user.profileId,
      organizationId,
    );
  }

  @Get(':organizationId')
  @ApiOperation({ summary: 'Get organization details' })
  @ApiParam({ name: 'organizationId', format: 'uuid' })
  @ApiStandardResponse(OrganizationResponseDto)
  getOrganization(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    return this.organizationsService.getOrganization(
      user.profileId,
      organizationId,
    );
  }

  @Patch(':organizationId')
  @ApiOperation({ summary: 'Update organization details' })
  @ApiParam({ name: 'organizationId', format: 'uuid' })
  @ApiStandardResponse(OrganizationResponseDto)
  updateOrganization(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.updateOrganization(
      user.profileId,
      organizationId,
      dto,
    );
  }

  @Post(':organizationId/image-upload-url')
  @ApiOperation({ summary: "Get a presigned URL to upload the org's logo" })
  @ApiParam({ name: 'organizationId', format: 'uuid' })
  @ApiStandardResponse(OrganizationImageUploadUrlDto)
  createImageUploadUrl(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: OrganizationImageUploadDto,
  ) {
    return this.organizationsService.createImageUploadUrl(
      user.profileId,
      organizationId,
      dto,
    );
  }

  @Post(':organizationId/image')
  @ApiOperation({ summary: 'Confirm an uploaded organization logo' })
  @ApiParam({ name: 'organizationId', format: 'uuid' })
  @ApiStandardResponse(OrganizationResponseDto)
  confirmImage(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: ConfirmOrganizationImageDto,
  ) {
    return this.organizationsService.confirmImage(
      user.profileId,
      organizationId,
      dto,
    );
  }

  @Delete(':organizationId/image')
  @ApiOperation({ summary: "Remove the organization's logo" })
  @ApiParam({ name: 'organizationId', format: 'uuid' })
  @ApiStandardResponse(OrganizationResponseDto)
  removeImage(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    return this.organizationsService.removeImage(user.profileId, organizationId);
  }

  @Delete(':organizationId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete organization and all its data' })
  @ApiParam({ name: 'organizationId', format: 'uuid' })
  @ApiVoidResponse()
  deleteOrganization(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    return this.organizationsService.deleteOrganization(
      user.profileId,
      organizationId,
    );
  }
}
