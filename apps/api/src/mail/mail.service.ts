import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { APP_CONFIG, AppConfig } from '../config/env';

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Transport abstraction; tests swap in {@link InMemoryMailer}. */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}

@Injectable()
export class SmtpMailer extends Mailer {
  private readonly transport: Transporter;
  private readonly logger = new Logger(SmtpMailer.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
    this.transport = createTransport({
      host: config.SMTP_HOST ?? 'localhost',
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER
        ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
        : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.config.MAIL_FROM, ...message });
    this.logger.log({ to: message.to, subject: message.subject }, 'Email sent');
  }
}

/** Mailjet's HTTPS API (v3.1); works where outbound SMTP ports are blocked. */
@Injectable()
export class MailjetMailer extends Mailer {
  private readonly logger = new Logger(MailjetMailer.name);
  private readonly from: { Email: string; Name?: string };
  private readonly auth: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    this.from = parseAddress(config.MAIL_FROM);
    this.auth = Buffer.from(
      `${config.MAILJET_API_KEY}:${config.MAILJET_SECRET_KEY}`,
    ).toString('base64');
  }

  async send(message: MailMessage): Promise<void> {
    const res = await fetch('https://api.mailjet.com/v3.1/send', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        Messages: [
          {
            From: this.from,
            To: [{ Email: message.to }],
            Subject: message.subject,
            TextPart: message.text,
          },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Mailjet explains rejections (e.g. unverified sender) in the body.
      const detail = (await res.text()).slice(0, 500);
      throw new Error(`Mailjet responded ${res.status}: ${detail}`);
    }
    this.logger.log({ to: message.to, subject: message.subject }, 'Email sent');
  }
}

/** "Casino <a@b.c>" or "a@b.c" → Mailjet's {Email, Name}. */
export function parseAddress(value: string): { Email: string; Name?: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (!match) return { Email: value.trim() };
  const name = match[1].replace(/^"|"$/g, '').trim();
  return name
    ? { Email: match[2].trim(), Name: name }
    : { Email: match[2].trim() };
}

export class InMemoryMailer extends Mailer {
  readonly outbox: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
  }
}

/** Builds the transactional emails; links point at the web app. */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  sendVerification(to: string, token: string): Promise<void> {
    const link = `${this.config.APP_URL}/auth/verify-email?token=${encodeURIComponent(token)}`;
    return this.deliver({
      to,
      subject: 'Confirm your email address',
      text: `Welcome! Confirm your email address by opening this link within 24 hours:\n\n${link}\n\nIf you did not create an account, ignore this email.`,
    });
  }

  sendPasswordReset(to: string, token: string): Promise<void> {
    const link = `${this.config.APP_URL}/auth/reset-password?token=${encodeURIComponent(token)}`;
    return this.deliver({
      to,
      subject: 'Reset your password',
      text: `Someone asked to reset your password. The link below is valid for one hour:\n\n${link}\n\nIf this was not you, you can ignore this email; your password is unchanged.`,
    });
  }

  /** Email failures must not fail the request (or reveal anything); they are logged instead. */
  private async deliver(message: MailMessage): Promise<void> {
    try {
      await this.mailer.send(message);
    } catch (err) {
      this.logger.error(
        { err, subject: message.subject },
        'Email delivery failed',
      );
    }
  }
}
