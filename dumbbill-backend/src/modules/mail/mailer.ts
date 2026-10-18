import { createTransport, Transporter } from 'nodemailer';

/**
 * Sending email, behind one small interface so the rest of the app does not care how it travels.
 *
 *  - Development: `SmtpMailer` talking to Mailpit (started by docker compose). Mailpit catches every
 *    email and shows it at http://localhost:8025, so nothing real is ever sent from your computer.
 *  - Production: the same `SmtpMailer`, pointed at Amazon SES's SMTP endpoint (MAIL_SMTP_URL). SES accepts
 *    ordinary SMTP, so one adapter serves both and no AWS library is needed.
 *  - Tests: `MemoryMailer`, which keeps the emails in a list so a test can read the verification link.
 */
export interface MailMessage {
  to: string;
  subject: string;
  /** Plain-text body. Always provided: some people and some mail apps only show this. */
  text: string;
  /** Simple HTML version. */
  html: string;
}

export abstract class Mailer {
  /** Send one email. Rejects if the mail server refuses it. */
  abstract send(message: MailMessage): Promise<void>;
}

/** Sends through an SMTP server. */
export class SmtpMailer extends Mailer {
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    super();
    this.transport = createTransport(smtpUrl);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}

/** Keeps sent emails in memory. For automated tests only. */
export class MemoryMailer extends Mailer {
  readonly outbox: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
  }

  /** The most recent email sent to an address, or undefined. */
  lastTo(address: string): MailMessage | undefined {
    return [...this.outbox].reverse().find((m) => m.to.toLowerCase() === address.toLowerCase());
  }
}
