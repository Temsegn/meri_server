import { HttpStatus, Injectable, Logger } from '@nestjs/common'
import { env } from '../config/env'
import { fail } from '../common/errors'

export type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } }
export type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] }
export type FunctionDeclaration = { name: string; description: string; parameters: Record<string, unknown> }

type GenerateOptions = {
  system: string
  contents: GeminiContent[]
  tools?: FunctionDeclaration[]
  /** 'NONE' forces a plain text answer even when tools are declared. */
  toolMode?: 'AUTO' | 'NONE'
  json?: Record<string, unknown>
  temperature?: number
}

/** Thin client for the Gemini REST API (generateContent). Model and key come from the environment. */
@Injectable()
export class GeminiClient {
  private readonly logger = new Logger(GeminiClient.name)

  get enabled() {
    return Boolean(env.GEMINI_API_KEY)
  }

  async generate(options: GenerateOptions): Promise<GeminiContent> {
    if (!this.enabled) fail(HttpStatus.SERVICE_UNAVAILABLE, 'AI_UNAVAILABLE', 'Meri Assistant is not configured on the server yet.')
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: options.system }] },
      contents: options.contents,
      generationConfig: {
        temperature: options.temperature ?? 0.6,
        ...(options.json ? { responseMimeType: 'application/json', responseSchema: options.json } : {}),
      },
    }
    if (options.tools?.length) {
      body.tools = [{ functionDeclarations: options.tools }]
      body.toolConfig = { functionCallingConfig: { mode: options.toolMode ?? 'AUTO' } }
    }

    let res: Response
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      })
    } catch (error) {
      this.logger.warn(`Gemini request failed: ${(error as Error).message}`)
      return fail(HttpStatus.BAD_GATEWAY, 'AI_FAILED', 'Meri Assistant could not be reached. Please try again.')
    }
    if (res.status === 429) fail(HttpStatus.TOO_MANY_REQUESTS, 'AI_BUSY', 'Meri Assistant is busy right now. Try again in a minute.')
    if (!res.ok) {
      this.logger.warn(`Gemini ${res.status}: ${(await res.text()).slice(0, 500)}`)
      fail(HttpStatus.BAD_GATEWAY, 'AI_FAILED', 'Meri Assistant could not answer. Please try again.')
    }
    const data = (await res.json()) as { candidates?: { content?: GeminiContent; finishReason?: string }[] }
    const content = data.candidates?.[0]?.content
    if (!content?.parts?.length) {
      const reason = data.candidates?.[0]?.finishReason
      fail(HttpStatus.BAD_GATEWAY, 'AI_EMPTY', reason === 'SAFETY' ? 'I can’t help with that one.' : 'Meri Assistant gave no answer. Please try again.')
    }
    return { role: 'model', parts: content.parts }
  }
}

export const textOf = (c: GeminiContent) =>
  c.parts
    .map((p) => ('text' in p ? p.text : ''))
    .join('')
    .trim()

export const callsOf = (c: GeminiContent) =>
  c.parts.flatMap((p) => ('functionCall' in p ? [{ name: p.functionCall.name, args: p.functionCall.args ?? {} }] : []))
