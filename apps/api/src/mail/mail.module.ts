import { Global, Module } from '@nestjs/common';
import { MailService, Mailer, SmtpMailer } from './mail.service';

@Global()
@Module({
  providers: [{ provide: Mailer, useClass: SmtpMailer }, MailService],
  exports: [MailService],
})
export class MailModule {}
