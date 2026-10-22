import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { Mailer, MailMessage } from './mail.service';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

/**
 * Sends through the Gmail API as the Google account that granted the refresh
 * token. Mail leaves Google's own servers, so it passes Gmail's DMARC checks,
 * and it uses HTTPS (works where SMTP ports are blocked).
 */
@Injectable()
export class GmailMailer extends Mailer {
  private readonly logger = new Logger(GmailMailer.name);
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  async send(message: MailMessage): Promise<void> {
    const res = await fetch(SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: toBase64Url(this.mime(message)) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      if (res.status === 401) this.accessToken = null;
      const detail = (await res.text()).slice(0, 500);
      throw new Error(`Gmail API responded ${res.status}: ${detail}`);
    }
    this.logger.log({ to: message.to, subject: message.subject }, 'Email sent');
  }

  /** Access tokens last an hour; refresh a minute early. */
  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) {
      return this.accessToken.value;
    }
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.GMAIL_CLIENT_ID ?? '',
        client_secret: this.config.GMAIL_CLIENT_SECRET ?? '',
        refresh_token: this.config.GMAIL_REFRESH_TOKEN ?? '',
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // invalid_grant: the refresh token was revoked or expired (e.g. the
      // Google Cloud app is still in "Testing" mode, where tokens last 7 days).
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`Google token refresh failed ${res.status}: ${detail}`);
    }
    const body = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.accessToken = {
      value: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    return body.access_token;
  }

  private mime(message: MailMessage): string {
    return [
      `From: ${encodeHeaderAddress(this.config.MAIL_FROM)}`,
      `To: ${message.to}`,
      `Subject: ${encodeHeader(message.subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(message.text, 'utf8')
        .toString('base64')
        .replace(/.{76}/g, '$&\r\n'),
    ].join('\r\n');
  }
}

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

/** RFC 2047 encoded-word for non-ASCII header text. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7f]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** "Casino <a@b.c>" with a possibly non-ASCII display name. */
function encodeHeaderAddress(value: string): string {
  const match = /^\s*"?(.*?)"?\s*<([^>]+)>\s*$/.exec(value);
  return match && match[1]
    ? `${encodeHeader(match[1])} <${match[2]}>`
    : value.trim();
}
