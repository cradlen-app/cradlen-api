import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../common/authorization/authorization.module';
import { LabTestsController } from './lab-tests.controller';
import { LabTestsService } from './lab-tests.service';

@Module({
  imports: [AuthorizationModule],
  controllers: [LabTestsController],
  providers: [LabTestsService],
  exports: [LabTestsService],
})
export class LabTestsModule {}
