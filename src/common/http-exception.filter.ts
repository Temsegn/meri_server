import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { Response } from 'express'
import type { ErrorBody } from './errors'

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error')

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>()
    const { status, body } = this.toError(exception)
    if (status >= 500) this.logger.error(exception)
    res.status(status).json({ error: body })
  }

  private toError(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const response = exception.getResponse()
      if (typeof response === 'object' && response && 'code' in response) {
        return { status, body: response as ErrorBody }
      }
      const message =
        typeof response === 'string'
          ? response
          : String((response as { message?: unknown }).message ?? exception.message)
      return { status, body: { code: HttpStatus[status] ?? 'ERROR', message } }
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      return { status: 409, body: { code: 'CONFLICT', message: 'That record already exists.' } }
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2025') {
      return { status: 404, body: { code: 'NOT_FOUND', message: 'Record not found.' } }
    }
    return { status: 500, body: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } }
  }
}
