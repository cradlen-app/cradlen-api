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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { ApiStandardResponse, ApiVoidResponse } from '@common/swagger/index.js';
import { OrganizationsService } from './organizations.service.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new organization' })
  @ApiStandardResponse(Object)
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
  @ApiStandardResponse(Object)
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
  @ApiStandardResponse(Object)
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
  @ApiStandardResponse(Object)
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

  @Delete(':organizationId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete organization and all its data' })
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
