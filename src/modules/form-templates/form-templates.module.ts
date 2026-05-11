import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../common/authorization/authorization.module';
import { FormTemplatesController } from './form-templates.controller';
import { FormTemplatesService } from './form-templates.service';
import { FormTemplateResolverService } from './form-template-resolver.service';
import { FormSchemaValidatorService } from './form-schema-validator.service';

@Module({
  imports: [AuthorizationModule],
  controllers: [FormTemplatesController],
  providers: [
    FormTemplatesService,
    FormTemplateResolverService,
    FormSchemaValidatorService,
  ],
  exports: [FormTemplateResolverService, FormSchemaValidatorService],
})
export class FormTemplatesModule {}
