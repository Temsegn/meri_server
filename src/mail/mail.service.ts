import { Injectable, Logger } from '@nestjs/common'
import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../config/env'

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)
  private readonly transport: Transporter | null = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null

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
