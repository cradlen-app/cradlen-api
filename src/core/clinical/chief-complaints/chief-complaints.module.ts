import { Module } from '@nestjs/common';
import { ChiefComplaintsController } from './chief-complaints.controller';
import { ChiefComplaintsService } from './chief-complaints.service';

@Module({
  controllers: [ChiefComplaintsController],
  providers: [ChiefComplaintsService],
})
export class ChiefComplaintsModule {}
