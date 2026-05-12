import { Module } from '@nestjs/common';
import { JobFunctionsController } from './job-functions.controller.js';
import { JobFunctionsService } from './job-functions.service.js';

@Module({
  controllers: [JobFunctionsController],
  providers: [JobFunctionsService],
})
export class JobFunctionsModule {}
