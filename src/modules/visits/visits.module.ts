import { Module } from '@nestjs/common';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';
import { VisitsGateway } from './visits.gateway';

@Module({
  controllers: [VisitsController],
  providers: [VisitsService, VisitsGateway],
})
export class VisitsModule {}
