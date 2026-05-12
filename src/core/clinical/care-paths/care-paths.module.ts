import { Module } from '@nestjs/common';
import { CarePathsController } from './care-paths.controller';
import { CarePathsService } from './care-paths.service';

@Module({
  controllers: [CarePathsController],
  providers: [CarePathsService],
  exports: [CarePathsService],
})
export class CarePathsModule {}
