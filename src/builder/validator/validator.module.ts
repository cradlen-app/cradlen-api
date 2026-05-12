import { Module } from '@nestjs/common';
import { TemplateValidator } from './template.validator.js';
import { TemplatesModule } from '../templates/templates.module.js';
import { RendererModule } from '../renderer/renderer.module.js';

@Module({
  imports: [TemplatesModule, RendererModule],
  providers: [TemplateValidator],
  exports: [TemplateValidator],
})
export class ValidatorModule {}
