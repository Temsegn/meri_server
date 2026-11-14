import { Injectable } from '@nestjs/common'
import { assistantTools } from './assistant.tools'
import { GeminiClient, callsOf, textOf, type GeminiContent } from './gemini.client'

export type ChatInput = {
  messages: { role: 'user' | 'assistant'; text: string }[]
  context: Record<string, unknown>
  today: string
  now: string
  language?: string
}

const persona = (input: { today: string; now: string; language?: string; name?: string }) => `You are Meri, the personal assistant inside the Meri app ("Small steps. Better life.").
You help ${input.name || 'the user'} with habits, their daily plan, notes, money (income and spending), food and water, and motivation.
Today is ${input.today} and the time is ${input.now} on the user's device.

How you work:
- Be warm, encouraging and non-judgmental, and genuinely practical. Keep answers short (a few sentences or a tight list) unless asked for more.
- Ground everything in the user's data in CONTEXT. Never invent habits, tasks, notes, money, foods or numbers that are not there. If something is missing, say so.
- You can operate the whole app with tools: daily plan (tasks, daily review), habits, notes, money (income, spending, budgets, loans), food (food list, meal plan), water, contacts and alarms. When the user asks to add, change, schedule, plan, check off, record, write, delete or set something, call the tools. Use ids exactly as given in CONTEXT. Several actions in one message are fine.
- Money: when the user says they spent, paid, bought, earned or received something, call record_transaction with the amount, a fitting category from CONTEXT.finance and a short description. Ask only if the amount is missing. Answer money questions from CONTEXT.finance; never guess totals.
- Food: to plan a meal that isn't in CONTEXT.foods, first add_food, then tell the user it's added (you can't plan it in the same turn without its id).
- "Plan my day": create a realistic timeline of tasks with times after ${input.now}, leaving breaks; include unfinished important tasks first. Don't duplicate tasks that already exist.
- Delete only when the user clearly asks to delete or remove something. Every action can be undone on the device, so act instead of asking for confirmation.
- Dates are YYYY-MM-DD and times are 24-hour HH:mm. Resolve "tomorrow", "Monday", "this evening" etc. from today's date and time. Habits can only be checked in for today.
- Spoken commands may be transcribed imperfectly; infer the most likely meaning.
- After using tools, briefly confirm what you did in plain words.
- Reply in ${input.language === 'am' ? 'Amharic' : 'the language the user writes in'}.
- You are not a doctor or therapist; for health or crisis topics, be supportive and suggest professional help.`

@Injectable()
export class AssistantService {
  constructor(private readonly gemini: GeminiClient) {}

  get enabled() {
    return this.gemini.enabled
  }

  async chat(input: ChatInput) {
    const system = `${persona({ ...input, name: String(input.context.firstName ?? '') })}\n\nCONTEXT (JSON):\n${JSON.stringify(input.context)}`
    const contents: GeminiContent[] = input.messages.slice(-20).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }],
    }))
    const first = await this.gemini.generate({ system, contents, tools: assistantTools })
    const actions = callsOf(first)
    if (!actions.length) return { reply: textOf(first), actions: [] }

    // Tools run on the device; tell the model they were applied and ask it to confirm in words.
    const follow = await this.gemini.generate({
      system,
      tools: assistantTools,
      toolMode: 'NONE',
      contents: [
        ...contents,
        first,
        { role: 'user', parts: actions.map((a) => ({ functionResponse: { name: a.name, response: { status: 'applied on the user’s device' } } })) },
      ],
    })
    return { reply: textOf(follow) || textOf(first), actions }
  }

  async note(input: { action: string; title: string; content: string; question?: string; language?: string }) {
    const tasks: Record<string, string> = {
      summarize: 'Summarize this note in 3–5 short bullet points ("- "). Keep the key facts, decisions and to-dos.',
      improve: 'Rewrite this note so it reads clearly and naturally. Keep the meaning, facts and the author’s voice. Return only the rewritten note.',
      continue: 'Continue writing this note naturally from where it ends, in the same voice, for one or two short paragraphs. Return only the new text.',
      checklist: 'Turn this note into an actionable checklist. Return only lines in the form "- [ ] item".',
      title: 'Suggest one short title (max 6 words) for this note. Return only the title.',
      ask: `Answer the user's question about this note: "${input.question ?? ''}". Use only the note; say so if it doesn't contain the answer.`,
    }
    const system = `You are Meri, a writing helper inside a notes app. ${tasks[input.action] ?? tasks.summarize}
Reply in ${input.language === 'am' ? 'Amharic' : 'the same language as the note'}. Plain text, no preamble.`
    const answer = await this.gemini.generate({
      system,
      temperature: input.action === 'improve' || input.action === 'continue' ? 0.7 : 0.3,
      contents: [{ role: 'user', parts: [{ text: `TITLE: ${input.title}\n\nNOTE:\n${input.content}` }] }],
    })
    return { text: textOf(answer) }
  }

  async recommendations(input: { context: Record<string, unknown>; today: string; now: string; language?: string }) {
    const answer = await this.gemini.generate({
      system: `${persona({ ...input, name: String(input.context.firstName ?? '') })}

Give 3 short, specific recommendations for today based only on CONTEXT: one about habits/consistency, one about the day's plan, and one about wellbeing (food, water, rest or notes). Each: a title of max 6 words and a body of max 25 words. Be encouraging and concrete; mention real habit or task names.

CONTEXT (JSON):
${JSON.stringify(input.context)}`,
      temperature: 0.5,
      json: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { kind: { type: 'string', enum: ['habits', 'plan', 'wellbeing'] }, title: { type: 'string' }, body: { type: 'string' } },
              required: ['kind', 'title', 'body'],
            },
          },
        },
        required: ['items'],
      },
      contents: [{ role: 'user', parts: [{ text: 'What should I focus on today?' }] }],
    })
    try {
      const parsed = JSON.parse(textOf(answer)) as { items?: { kind: string; title: string; body: string }[] }
      return { items: (parsed.items ?? []).slice(0, 3) }
    } catch {
      return { items: [] }
    }
  }
}
