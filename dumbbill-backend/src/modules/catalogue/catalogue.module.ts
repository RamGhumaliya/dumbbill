import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CategoriesService } from './categories.service';
import { ProductImportService } from './import.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/**
 * The catalogue (P1-4): products with variants, barcodes, HSN and GST, categories, effective-dated price history,
 * pictures and CSV import. It uses the global Tenancy, Audit, Storage and Permissions modules, and AuthModule for the
 * shared clock (so tests can move time to check scheduled prices).
 */
@Module({
  imports: [AuthModule],
  controllers: [ProductsController],
  providers: [ProductsService, ProductImportService, CategoriesService],
})
export class CatalogueModule {}
