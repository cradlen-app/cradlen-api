import { Module } from '@nestjs/common';
import { JourneyTemplatesController } from './journey-templates.controller';
import { JourneyTemplatesService } from './journey-templates.service';

@Module({
  controllers: [JourneyTemplatesController],
  providers: [JourneyTemplatesService],
})
export class JourneyTemplatesModule {}
