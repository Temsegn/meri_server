import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { z } from 'zod'
import { ZodPipe } from '../common/zod.pipe'
import { AssistantService } from './assistant.service'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const hm = z.string().regex(/^\d{2}:\d{2}$/)
const context = z.record(z.unknown())
const chatSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().min(1).max(4000) })).min(1).max(40),
  context,
  today: day,
  now: hm,
  language: z.string().max(5).optional(),
})
const noteSchema = z.object({
  action: z.enum(['summarize', 'improve', 'continue', 'checklist', 'title', 'ask']),
  title: z.string().max(300).default(''),
  content: z.string().min(1, 'The note is empty.').max(40_000),
  question: z.string().max(1000).optional(),
  language: z.string().max(5).optional(),
})
const recSchema = z.object({ context, today: day, now: hm, language: z.string().max(5).optional() })

/** Meri Assistant (Gemini). Always online; the app's data itself stays offline-first. */
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('status')
  status() {
    return { enabled: this.assistant.enabled }
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('chat')
  chat(@Body(new ZodPipe(chatSchema)) body: z.infer<typeof chatSchema>) {
    return this.assistant.chat(body)
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('notes')
  note(@Body(new ZodPipe(noteSchema)) body: z.infer<typeof noteSchema>) {
    return this.assistant.note(body)
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('recommendations')
  recommendations(@Body(new ZodPipe(recSchema)) body: z.infer<typeof recSchema>) {
    return this.assistant.recommendations(body)
  }
}
