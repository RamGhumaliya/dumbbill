import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StockController, TransfersController } from './stock.controller';
import { StockEngine } from './stock-engine';
import { StockService } from './stock.service';
import { TransfersService } from './transfers.service';

/**
 * Inventory (P1-5): the stock engine (the one place stock changes), stock levels and the ledger, counts, write-offs,
 * alerts, the consistency checks, and transfers between branches. The engine is exported so purchasing (and later the
 * till) change stock through it too. AuthModule supplies the shared clock.
 */
@Module({
  imports: [AuthModule],
  controllers: [StockController, TransfersController],
  providers: [StockEngine, StockService, TransfersService],
  exports: [StockEngine],
})
export class InventoryModule {}
