import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/swagger';
import { TemplatesService } from './templates.service.js';
import { TemplateRendererService } from '../renderer/template-renderer.service.js';
import {
  FormTemplateDto,
  FormTemplateSummaryDto,
} from './dto/form-template.dto.js';

@ApiTags('form-templates')
@Controller({ path: 'form-templates', version: '1' })
export class TemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly renderer: TemplateRendererService,
  ) {}

  @Get()
  @ApiStandardResponse(FormTemplateSummaryDto)
  async list() {
    return this.templates.listActive();
  }

  @Get(':code')
  @ApiStandardResponse(FormTemplateDto)
  async getActive(@Param('code') code: string) {
    const row = await this.templates.findActiveByCode(code);
    return this.renderer.render(row);
  }

  @Get(':code/versions/:version')
  @ApiStandardResponse(FormTemplateDto)
  async getVersion(
    @Param('code') code: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    const row = await this.templates.findVersion(code, version);
    return this.renderer.render(row);
  }
}
