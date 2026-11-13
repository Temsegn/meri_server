import { HttpStatus, PipeTransform } from '@nestjs/common'
import type { ZodTypeAny, z } from 'zod'
import { fail } from './errors'

/** Validates and parses a body/query with a Zod schema; returns field errors in the API error shape. */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value)
    if (result.success) return result.data
    const fields: Record<string, string> = {}
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || 'body'
      fields[key] ??= issue.message
    }
    return fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Please check the highlighted fields.', fields)
  }
}
