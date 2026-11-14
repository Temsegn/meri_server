import type { FunctionDeclaration } from './gemini.client'

const date = { type: 'string', description: 'Date as YYYY-MM-DD.' }
const time = { type: 'string', description: '24-hour time as HH:mm.' }
const id = (what: string) => ({ type: 'string', description: `The ${what}'s id from CONTEXT.` })
const priority = { type: 'string', enum: ['low', 'medium', 'high'] }
const method = { type: 'string', enum: ['cash', 'bank', 'mobile', 'other'], description: 'How money moved; mobile = mobile money like telebirr.' }
const days = { type: 'array', items: { type: 'integer' }, description: 'Weekdays, 0 = Sunday … 6 = Saturday.' }
const slot = { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack', 'drink'] }

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required })

/**
 * Everything the assistant can do inside the app, by voice or text. Actions run on the user's device
 * (the app is offline-first) and sync like any other change; each reply's actions can be undone there.
 */
export const assistantTools: FunctionDeclaration[] = [
  // ── Daily plan ──
  {
    name: 'create_task',
    description: 'Add a task to the daily plan. One call per task; give times to build a timeline for the day.',
    parameters: obj(
      {
        title: { type: 'string' },
        date,
        time,
        priority,
        category: { type: 'string', enum: ['Personal', 'Work', 'Study', 'Health', 'Home', 'Errands'] },
        important: { type: 'boolean' },
        reminder: { type: 'boolean', description: 'Remind the user at the task time.' },
        notes: { type: 'string' },
      },
      ['title', 'date'],
    ),
  },
  {
    name: 'update_task',
    description: 'Change a task from CONTEXT: mark done/undone, move it, rename it, or change priority.',
    parameters: obj({ taskId: id('task'), done: { type: 'boolean' }, title: { type: 'string' }, date, time, priority, important: { type: 'boolean' } }, ['taskId']),
  },
  { name: 'delete_task', description: 'Delete a task. Only when the user clearly asks to delete or remove it.', parameters: obj({ taskId: id('task') }, ['taskId']) },
  {
    name: 'save_daily_review',
    description: 'Save the evening review of a day (what got done, what was missed, what went well, what to improve).',
    parameters: obj({ date, completed: { type: 'string' }, missed: { type: 'string' }, wentWell: { type: 'string' }, improve: { type: 'string' } }, ['date']),
  },

  // ── Habits ──
  {
    name: 'create_habit',
    description: 'Create a new habit.',
    parameters: obj(
      {
        name: { type: 'string' },
        kind: { type: 'string', enum: ['good', 'reduce'] },
        category: { type: 'string', enum: ['Health', 'Fitness', 'Mind', 'Learning', 'Productivity', 'Finance', 'Social', 'Other'] },
        days: { ...days, description: `${days.description} Omit for every day.` },
        targetType: { type: 'string', enum: ['check', 'quantity', 'duration'] },
        target: { type: 'integer', description: 'Daily target for quantity/duration habits.' },
        unit: { type: 'string', description: 'e.g. pages, glasses, minutes.' },
        reminder: time,
      },
      ['name'],
    ),
  },
  {
    name: 'update_habit',
    description: 'Change a habit from CONTEXT: rename, change its days, daily target or reminder time.',
    parameters: obj({ habitId: id('habit'), name: { type: 'string' }, days, target: { type: 'integer' }, reminder: { type: 'string', description: 'HH:mm, or "none" to remove the reminder.' } }, ['habitId']),
  },
  {
    name: 'log_habit',
    description: 'Check in a habit for today (done), undo a check-in (done=false), or set today’s amount.',
    parameters: obj({ habitId: id('habit'), done: { type: 'boolean' }, value: { type: 'integer' } }, ['habitId']),
  },
  { name: 'delete_habit', description: 'Delete a habit and its history. Only when the user clearly asks.', parameters: obj({ habitId: id('habit') }, ['habitId']) },

  // ── Notes ──
  {
    name: 'create_note',
    description: 'Write a new note.',
    parameters: obj(
      {
        title: { type: 'string' },
        content: { type: 'string', description: 'Plain text. Use "- [ ] item" lines for checklists and "- " for bullets.' },
        category: { type: 'string', enum: ['Personal', 'Work', 'Ideas', 'Journal', 'Checklist'] },
        pinned: { type: 'boolean' },
      },
      ['title', 'content'],
    ),
  },
  { name: 'append_to_note', description: 'Add text to the end of a note from CONTEXT.', parameters: obj({ noteId: id('note'), content: { type: 'string' } }, ['noteId', 'content']) },
  {
    name: 'update_note',
    description: 'Rename a note, replace its whole text, pin/unpin it, or change its category.',
    parameters: obj({ noteId: id('note'), title: { type: 'string' }, content: { type: 'string' }, pinned: { type: 'boolean' }, category: { type: 'string' } }, ['noteId']),
  },
  { name: 'delete_note', description: 'Delete a note. Only when the user clearly asks.', parameters: obj({ noteId: id('note') }, ['noteId']) },

  // ── Money ──
  {
    name: 'record_transaction',
    description: 'Record money received (income) or spent (expense). Use a category from CONTEXT.finance; amounts are in the user’s currency.',
    parameters: obj(
      {
        type: { type: 'string', enum: ['income', 'expense'] },
        amount: { type: 'number', description: 'Positive amount, no currency symbol.' },
        category: { type: 'string', description: 'One of the user’s categories for that type.' },
        description: { type: 'string', description: 'What it was for, e.g. "Lunch at Kaldi’s".' },
        date: { ...date, description: 'Day of the transaction (today or earlier).' },
        method,
        note: { type: 'string' },
      },
      ['type', 'amount', 'description'],
    ),
  },
  { name: 'delete_transaction', description: 'Delete a transaction from CONTEXT.finance.recent. Only when the user clearly asks.', parameters: obj({ transactionId: id('transaction') }, ['transactionId']) },
  {
    name: 'set_budget',
    description: 'Set a monthly spending limit for an expense category.',
    parameters: obj({ category: { type: 'string' }, amount: { type: 'number' }, month: { type: 'integer', description: '1–12; default this month.' }, year: { type: 'integer' } }, ['category', 'amount']),
  },
  {
    name: 'add_loan',
    description: 'Record money lent to someone (lent) or borrowed from someone (borrowed).',
    parameters: obj(
      { direction: { type: 'string', enum: ['lent', 'borrowed'] }, person: { type: 'string' }, amount: { type: 'number' }, date, dueDate: date, method, note: { type: 'string' } },
      ['direction', 'person', 'amount'],
    ),
  },
  {
    name: 'record_loan_payment',
    description: 'Record a repayment on a loan from CONTEXT.finance.loans.',
    parameters: obj({ loanId: id('loan'), amount: { type: 'number' }, date, method }, ['loanId', 'amount']),
  },

  // ── Food & water ──
  {
    name: 'add_food',
    description: 'Add a food or recipe to the user’s food list (so it can be planned).',
    parameters: obj(
      {
        name: { type: 'string' },
        description: { type: 'string' },
        calories: { type: 'integer' },
        protein: { type: 'integer', description: 'grams' },
        carbs: { type: 'integer', description: 'grams' },
        fat: { type: 'integer', description: 'grams' },
        slots: { type: 'array', items: slot, description: 'Meals it suits.' },
      },
      ['name'],
    ),
  },
  { name: 'plan_meal', description: 'Put a food from CONTEXT.foods into the meal plan.', parameters: obj({ date, slot, foodId: id('food'), time }, ['date', 'slot', 'foodId']) },
  { name: 'remove_meal', description: 'Remove a planned meal.', parameters: obj({ date, slot }, ['date', 'slot']) },
  { name: 'mark_meal_eaten', description: 'Mark today’s planned meal as eaten (or not).', parameters: obj({ slot, eaten: { type: 'boolean' } }, ['slot']) },
  { name: 'set_water', description: 'Set how many glasses of water the user drank on a day.', parameters: obj({ date, glasses: { type: 'integer' } }, ['date', 'glasses']) },

  // ── People & time ──
  {
    name: 'add_contact',
    description: 'Save a new contact.',
    parameters: obj(
      {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        company: { type: 'string' },
        birthday: date,
        category: { type: 'string', enum: ['Family', 'Friends', 'Work', 'Other'] },
        notes: { type: 'string' },
      },
      ['firstName'],
    ),
  },
  {
    name: 'set_alarm',
    description: 'Set an alarm on the phone.',
    parameters: obj({ time, label: { type: 'string' }, days: { ...days, description: `${days.description} Omit to ring once.` } }, ['time']),
  },
]
