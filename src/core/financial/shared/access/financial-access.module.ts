import { Module } from '@nestjs/common';
import { FinancialAccessService } from './financial-access.service.js';

@Module({
  providers: [FinancialAccessService],
  exports: [FinancialAccessService],
})
export class FinancialAccessModule {}
