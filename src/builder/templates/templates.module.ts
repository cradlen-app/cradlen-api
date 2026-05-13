import { Module } from '@nestjs/common';
import { TemplatesController } from './templates.controller.js';
import { TemplatesService } from './templates.service.js';
import { TemplateCompositionService } from './template-composition.service.js';
import { RendererModule } from '../renderer/renderer.module.js';

@Module({
  imports: [RendererModule],
  controllers: [TemplatesController],
  providers: [TemplatesService, TemplateCompositionService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
