import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import {
  PurchasesController,
  SupplierReturnsController,
  SuppliersController,
} from './purchasing.controller';
import { PurchasesService } from './purchases.service';
import { SupplierReturnsService } from './supplier-returns.service';
import { SuppliersService } from './suppliers.service';

/**
 * Suppliers, purchases and supplier returns (P1-5). Stock itself is changed only through the inventory module's
 * `StockEngine`; AuthModule supplies the shared clock (so tests can move time to check expiry rules).
 */
@Module({
  imports: [AuthModule, InventoryModule],
  controllers: [SuppliersController, PurchasesController, SupplierReturnsController],
  providers: [SuppliersService, PurchasesService, SupplierReturnsService],
})
export class PurchasingModule {}
