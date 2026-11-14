import type { FunctionDeclaration } from './gemini.client'

const date = { type: 'string', description: 'Date as YYYY-MM-DD.' }
const time = { type: 'string', description: '24-hour time as HH:mm.' }

/**
 * Actions the assistant can take inside the app. They are executed on the user's device
 * (the app is offline-first), then synced like any other change.
 */
export const assistantTools: FunctionDeclaration[] = [
  {
    name: 'create_task',
    description: 'Add a task to the daily plan. Use one call per task; give times to build a timeline for the day.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        date,
        time,
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        category: { type: 'string', enum: ['Personal', 'Work', 'Study', 'Health', 'Home', 'Errands'] },
        important: { type: 'boolean' },
        reminder: { type: 'boolean', description: 'Remind the user at the task time.' },
        notes: { type: 'string' },
      },
      required: ['title', 'date'],
    },
  },
  {
    name: 'update_task',
    description: 'Change an existing task from the context: mark done/undone, move it, or edit it.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        done: { type: 'boolean' },
        title: { type: 'string' },
        date,
        time,
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'create_habit',
    description: 'Create a new habit.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        kind: { type: 'string', enum: ['good', 'reduce'] },
        category: { type: 'string', enum: ['Health', 'Fitness', 'Mind', 'Learning', 'Productivity', 'Finance', 'Social', 'Other'] },
        days: { type: 'array', items: { type: 'integer' }, description: 'Weekdays, 0 = Sunday … 6 = Saturday. Omit for every day.' },
        targetType: { type: 'string', enum: ['check', 'quantity', 'duration'] },
        target: { type: 'integer', description: 'Daily target for quantity/duration habits.' },
        unit: { type: 'string', description: 'e.g. pages, glasses, minutes.' },
        reminder: time,
      },
      required: ['name'],
    },
  },
  {
    name: 'log_habit',
    description: 'Check in a habit from the context for a day (done), or set its amount.',
    parameters: {
      type: 'object',
      properties: { habitId: { type: 'string' }, date, done: { type: 'boolean' }, value: { type: 'integer' } },
      required: ['habitId'],
    },
  },
  {
    name: 'create_note',
    description: 'Write a new note.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string', description: 'Plain text. Use "- [ ] item" lines for checklists.' },
        category: { type: 'string', enum: ['Personal', 'Work', 'Ideas', 'Journal', 'Checklist'] },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'append_to_note',
    description: 'Add text to the end of an existing note from the context.',
    parameters: { type: 'object', properties: { noteId: { type: 'string' }, content: { type: 'string' } }, required: ['noteId', 'content'] },
  },
  {
    name: 'plan_meal',
    description: 'Put a food from the user’s food list into the meal plan.',
    parameters: {
      type: 'object',
      properties: { date, slot: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] }, foodId: { type: 'string' }, time },
      required: ['date', 'slot', 'foodId'],
    },
  },
  {
    name: 'set_water',
    description: 'Set how many glasses of water the user drank on a day.',
    parameters: { type: 'object', properties: { date, glasses: { type: 'integer' } }, required: ['date', 'glasses'] },
  },
]
