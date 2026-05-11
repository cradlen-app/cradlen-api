import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { FormSurface } from '@prisma/client';
import { FormTemplatesService } from './form-templates.service';
import { FormTemplateResolverService } from './form-template-resolver.service';
import { ApiStandardResponse, ApiVoidResponse } from '../../common/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import {
  CreateFormTemplateDto,
  FormTemplateDto,
  FormTemplateVersionDto,
  UpdateFormTemplateVersionDto,
} from './dto/form-template.dto';

class ListFormTemplatesQueryDto {
  @IsOptional() @IsUUID() specialty_id?: string;
  @IsOptional() @IsEnum(FormSurface) surface?: FormSurface;
}

class ResolveFormTemplateQueryDto {
  @IsOptional() @IsUUID() specialty_id?: string;
}

@ApiTags('Form Templates')
@Controller('form-templates')
export class FormTemplatesController {
  constructor(
    private readonly service: FormTemplatesService,
    private readonly resolver: FormTemplateResolverService,
  ) {}

  @Get()
  @ApiQuery({ name: 'specialty_id', required: false })
  @ApiQuery({ name: 'surface', required: false, enum: FormSurface })
  @ApiStandardResponse(FormTemplateDto)
  list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListFormTemplatesQueryDto,
  ) {
    return this.service.list(user, query.specialty_id, query.surface);
  }

  @Get('resolve')
  @ApiQuery({ name: 'specialty_id', required: false })
  @ApiStandardResponse(FormTemplateVersionDto)
  resolve(
    @CurrentUser() user: AuthContext,
    @Query() query: ResolveFormTemplateQueryDto,
  ) {
    return this.resolver.resolveForEncounter({
      profileId: user.profileId,
      organizationId: user.organizationId,
      specialtyId: query.specialty_id,
    });
  }

  @Get(':id')
  @ApiStandardResponse(FormTemplateDto)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.findOne(id, user);
  }

  @Post()
  @ApiStandardResponse(FormTemplateDto)
  create(@Body() dto: CreateFormTemplateDto, @CurrentUser() user: AuthContext) {
    return this.service.create(dto, user);
  }

  @Post(':id/versions')
  @ApiStandardResponse(FormTemplateVersionDto)
  createDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.createDraftVersion(id, user);
  }

  @Patch(':id/versions/:versionId')
  @ApiStandardResponse(FormTemplateVersionDto)
  updateDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: UpdateFormTemplateVersionDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.updateDraftVersion(id, versionId, dto, user);
  }

  @Post(':id/versions/:versionId/publish')
  @ApiStandardResponse(FormTemplateVersionDto)
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.publishVersion(id, versionId, user);
  }

  @Delete(':id')
  @ApiVoidResponse()
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    await this.service.softDelete(id, user);
  }
}
