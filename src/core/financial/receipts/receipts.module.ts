import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { ReceiptsController } from './receipts.controller.js';
import { ReceiptsService } from './receipts.service.js';
import { ReceiptNumberService } from './receipt-number.service.js';
import { ReceiptsListener } from './receipts.listener.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [ReceiptsController],
  providers: [ReceiptNumberService, ReceiptsService, ReceiptsListener],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}
