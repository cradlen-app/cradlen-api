import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [PatientsController],
  providers: [PatientsService],
})
export class PatientsModule {}
