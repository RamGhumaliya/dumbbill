import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalDiskStorage } from './local-disk.storage';
import { FileStorage } from './storage.types';

/**
 * Provides `FileStorage` to the whole app.
 *
 * To use it in a service, inject the abstract class:
 *   constructor(private readonly storage: FileStorage) {}
 *
 * The driver comes from the STORAGE_DRIVER setting. Only "local" exists today;
 * an "s3" driver will be added here later and nothing else needs to change.
 */
@Global()
@Module({
  providers: [
    {
      provide: FileStorage,
      inject: [ConfigService],
      useFactory: (config: ConfigService): FileStorage =>
        new LocalDiskStorage({
          rootDir: config.getOrThrow<string>('STORAGE_LOCAL_DIR'),
          maxFileBytes: config.getOrThrow<number>('STORAGE_MAX_FILE_MB') * 1024 * 1024,
        }),
    },
  ],
  exports: [FileStorage],
})
export class StorageModule {}
