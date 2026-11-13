import { HttpException, HttpStatus } from '@nestjs/common'

export type ErrorBody = { code: string; message: string; fields?: Record<string, string> }

/** Throws the API's single error shape: `{ error: { code, message, fields? } }`. */
export function fail(status: HttpStatus, code: string, message: string, fields?: Record<string, string>): never {
  throw new HttpException({ code, message, fields } satisfies ErrorBody, status)
}

export const notFound = (what: string): never => fail(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} was not found.`)
