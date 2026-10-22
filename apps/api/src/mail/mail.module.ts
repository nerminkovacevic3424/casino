import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { MailService, Mailer, MailjetMailer, SmtpMailer } from './mail.service';

@Global()
@Module({
  providers: [
    {
      provide: Mailer,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Mailer =>
        config.MAIL_PROVIDER === 'mailjet'
          ? new MailjetMailer(config)
          : new SmtpMailer(config),
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
