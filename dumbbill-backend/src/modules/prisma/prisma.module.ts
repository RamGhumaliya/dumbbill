import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Makes `PrismaService` available everywhere without importing this module again.
 * (@Global means "register once, use anywhere".)
 */
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
