import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Mailer, SmtpMailer } from './mailer';

/**
 * Provides the `Mailer` to the whole app. Tests replace it with `MemoryMailer`
 * (`.overrideProvider(Mailer).useValue(...)`) so no real email is attempted.
 */
@Global()
@Module({
  providers: [
    {
      provide: Mailer,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Mailer =>
        new SmtpMailer(
          config.getOrThrow<string>('MAIL_SMTP_URL'),
          config.getOrThrow<string>('MAIL_FROM'),
        ),
    },
  ],
  exports: [Mailer],
})
export class MailModule {}
