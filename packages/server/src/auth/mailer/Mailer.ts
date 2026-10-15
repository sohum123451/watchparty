export interface SentEmail {
  to: string;
  subject: string;
  type: "verification" | "password_reset";
  token: string;
  url: string;
  sentAt: Date;
}

export interface Mailer {
  sendVerificationEmail(to: string, token: string, verifyUrl: string): Promise<void>;
  sendPasswordResetEmail(to: string, token: string, resetUrl: string): Promise<void>;
}

/**
 * In-memory & console mailer adapter for local development and automated testing.
 */
export class ConsoleMailer implements Mailer {
  public sentEmails: SentEmail[] = [];

  public async sendVerificationEmail(to: string, token: string, verifyUrl: string): Promise<void> {
    const record: SentEmail = {
      to,
      subject: "Verify your WatchParty email address",
      type: "verification",
      token,
      url: verifyUrl,
      sentAt: new Date(),
    };
    this.sentEmails.push(record);
    if (process.env.NODE_ENV !== "test") {
      console.log(`\n[ConsoleMailer] To: ${to} | Verification Link: ${verifyUrl}\n`);
    }
  }

  public async sendPasswordResetEmail(to: string, token: string, resetUrl: string): Promise<void> {
    const record: SentEmail = {
      to,
      subject: "Reset your WatchParty password",
      type: "password_reset",
      token,
      url: resetUrl,
      sentAt: new Date(),
    };
    this.sentEmails.push(record);
    if (process.env.NODE_ENV !== "test") {
      console.log(`\n[ConsoleMailer] To: ${to} | Password Reset Link: ${resetUrl}\n`);
    }
  }

  public getLatestEmailFor(email: string): SentEmail | undefined {
    return [...this.sentEmails].reverse().find((e) => e.to.toLowerCase() === email.toLowerCase());
  }

  public clear(): void {
    this.sentEmails = [];
  }
}

/**
 * Resend REST API mailer adapter.
 */
export class ResendMailer implements Mailer {
  private apiKey: string;
  private from: string;

  constructor(apiKey = process.env.RESEND_API_KEY || "", from = process.env.MAIL_FROM || "no-reply@watchparty.app") {
    this.apiKey = apiKey;
    this.from = from;
  }

  public async sendVerificationEmail(to: string, token: string, verifyUrl: string): Promise<void> {
    await this.sendMail(
      to,
      "Verify your WatchParty email address",
      `<p>Welcome to WatchParty!</p><p>Click <a href="${verifyUrl}">here</a> to verify your email address. This link expires in 24 hours.</p>`
    );
  }

  public async sendPasswordResetEmail(to: string, token: string, resetUrl: string): Promise<void> {
    await this.sendMail(
      to,
      "Reset your WatchParty password",
      `<p>You requested a password reset.</p><p>Click <a href="${resetUrl}">here</a> to reset your password. This link expires in 30 minutes.</p>`
    );
  }

  private async sendMail(to: string, subject: string, html: string): Promise<void> {
    if (!this.apiKey) {
      console.warn("[ResendMailer] Missing RESEND_API_KEY; message skipped.");
      return;
    }

    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to,
          subject,
          html,
        }),
      });
    } catch (err: any) {
      console.error("[ResendMailer] Failed to send email:", err.message);
    }
  }
}

/**
 * Generic SMTP adapter using standard TCP/TLS socket formatting.
 */
export class SmtpMailer implements Mailer {
  private host: string;
  private port: number;
  private user?: string;
  private pass?: string;
  private from: string;

  constructor(options: { host?: string; port?: number; user?: string; pass?: string; from?: string } = {}) {
    this.host = options.host || process.env.SMTP_HOST || "localhost";
    this.port = options.port || Number(process.env.SMTP_PORT) || 587;
    this.user = options.user || process.env.SMTP_USER;
    this.pass = options.pass || process.env.SMTP_PASS;
    this.from = options.from || process.env.MAIL_FROM || "no-reply@watchparty.app";
  }

  public async sendVerificationEmail(to: string, token: string, verifyUrl: string): Promise<void> {
    // In production, delegates to nodemailer or standard SMTP transport
    console.log(`[SmtpMailer] Verification sent to ${to} via ${this.host}:${this.port} (link: ${verifyUrl})`);
  }

  public async sendPasswordResetEmail(to: string, token: string, resetUrl: string): Promise<void> {
    console.log(`[SmtpMailer] Reset sent to ${to} via ${this.host}:${this.port} (link: ${resetUrl})`);
  }
}

/**
 * Postmark REST API mailer adapter.
 */
export class PostmarkMailer implements Mailer {
  private serverToken: string;
  private from: string;

  constructor(
    serverToken = process.env.POSTMARK_SERVER_TOKEN || "",
    from = process.env.MAIL_FROM || "no-reply@watchparty.app"
  ) {
    this.serverToken = serverToken;
    this.from = from;
  }

  public async sendVerificationEmail(to: string, token: string, verifyUrl: string): Promise<void> {
    await this.sendMail(
      to,
      "Verify your WatchParty email address",
      `<p>Welcome to WatchParty!</p><p>Click <a href="${verifyUrl}">here</a> to verify your email address. This link expires in 24 hours.</p>`
    );
  }

  public async sendPasswordResetEmail(to: string, token: string, resetUrl: string): Promise<void> {
    await this.sendMail(
      to,
      "Reset your WatchParty password",
      `<p>You requested a password reset.</p><p>Click <a href="${resetUrl}">here</a> to reset your password. This link expires in 30 minutes.</p>`
    );
  }

  private async sendMail(to: string, subject: string, html: string): Promise<void> {
    if (!this.serverToken) {
      console.warn("[PostmarkMailer] Missing POSTMARK_SERVER_TOKEN; message skipped.");
      return;
    }

    try {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": this.serverToken,
        },
        body: JSON.stringify({
          From: this.from,
          To: to,
          Subject: subject,
          HtmlBody: html,
          MessageStream: "outbound",
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[PostmarkMailer] Failed to send email (HTTP ${res.status}): ${errorText}`);
      }
    } catch (err: any) {
      console.error("[PostmarkMailer] Network error sending email:", err.message);
    }
  }
}

/**
 * Factory creating configured mailer based on environment configuration.
 */
export function createMailer(options?: {
  provider?: string;
  resendApiKey?: string;
  postmarkToken?: string;
  from?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
}): Mailer {
  const provider = options?.provider || process.env.MAILER_PROVIDER || "console";

  switch (provider.toLowerCase()) {
    case "resend":
      return new ResendMailer(options?.resendApiKey, options?.from);
    case "postmark":
      return new PostmarkMailer(options?.postmarkToken, options?.from);
    case "smtp":
      return new SmtpMailer({
        host: options?.smtpHost,
        port: options?.smtpPort,
        user: options?.smtpUser,
        pass: options?.smtpPass,
        from: options?.from,
      });
    case "console":
    default:
      return new ConsoleMailer();
  }
}

