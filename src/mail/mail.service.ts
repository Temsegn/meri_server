import { Injectable, Logger } from '@nestjs/common'
import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../config/env'

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)
  private readonly transport: Transporter | null = this.createTransport()

  /** A bad SMTP_URL disables email (with a log line) instead of crashing the API. */
  private createTransport(): Transporter | null {
    if (!env.SMTP_URL) return null
    if (!/^smtps?:\/\//.test(env.SMTP_URL)) {
      this.logger.error('SMTP_URL must start with smtp:// or smtps:// — email is disabled until it is fixed.')
      return null
    }
    try {
      return nodemailer.createTransport(env.SMTP_URL)
    } catch (error) {
      this.logger.error(`SMTP_URL is invalid (${(error as Error).message}) — email is disabled until it is fixed.`)
      return null
    }
  }

  /** Sends one email. Returns false (and logs) on failure instead of throwing. */
  async send(to: string, subject: string, text: string): Promise<boolean> {
    if (!this.transport) {
      this.logger.log(`[email disabled] to=${to} subject="${subject}"`)
      return false
    }
    try {
      await this.transport.sendMail({
        from: env.MAIL_FROM,
        to,
        subject,
        text: `${text}\n\n— MeriBoost\n${env.CLIENT_URL}/my-promotions`,
      })
      return true
    } catch (error) {
      this.logger.warn(`Email to ${to} failed: ${(error as Error).message}`)
      return false
    }
  }
}
