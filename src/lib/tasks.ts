/**
 * Reads and writes for the Tasks tab.  Row-level security decides what each
 * account gets back: an artist sees only tasks assigned to them and only their
 * own personal list; a manager sees everything.  Task tables hold no money
 * (CLAUDE.md rules 1 and 12).
 */
import { supabase } from './supabase.ts'
import { check, friendlyDbMessage } from './queries.ts'
import { addDays, todayChicago } from './dates.ts'

export type TaskPriority = 'high' | 'normal' | 'low'
export type TaskRecurrence = 'daily' | 'weekly' | 'biweekly' | 'monthly'

export interface Task {
  id: string
  title: string
  note: string | null
  priority: TaskPriority
  due_date: string | null
  order_id: string | null
  recurrence: TaskRecurrence | null
  status: 'open' | 'done'
  completed_by: string | null
  completed_at: string | null
  personal_item_id: string | null
  created_by: string | null
  created_at: string
  /** The linked order's name only (the brief: "the link shows the order's name only"). */
  order: { id: string; name: string } | null
  /** Everyone the task is assigned to (profile ids). */
  assignees: string[]
}

export interface PersonalItem {
  id: string
  owner_id: string
  text: string
  status: 'open' | 'approved' | 'done'
  task_id: string | null
  created_at: string
  edited_at: string | null
}

/** What an approved personal item became, from personal_item_outcomes(). */
export interface ItemOutcome {
  item_id: string
  task_id: string
  task_title: string
  task_status: 'open' | 'done'
  assignee_names: string[]
  approved_by: string | null
  approved_at: string
}

export const PRIORITY_LABEL: Record<TaskPriority, string> = { high: 'High', normal: 'Normal', low: 'Low' }
const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 }

export const RECURRENCE_LABEL: Record<TaskRecurrence, string> = {
  daily: 'Every day',
  weekly: 'Every week',
  biweekly: 'Every two weeks',
  monthly: 'Every month',
}

const TASK_COLUMNS =
  'id, title, note, priority, due_date, order_id, recurrence, status, completed_by, completed_at, ' +
  'personal_item_id, created_by, created_at, order:orders(id, name), task_assignees(profile_id)'

type TaskRow = Omit<Task, 'assignees'> & { task_assignees: { profile_id: string }[] }

function shape(rows: TaskRow[]): Task[] {
  return rows.map(({ task_assignees, ...t }) => ({ ...t, assignees: task_assignees.map((a) => a.profile_id) }))
}

/** True when an open task's due date has passed (Chicago time). */
export function isOverdue(task: Pick<Task, 'status' | 'due_date'>, today = todayChicago()): boolean {
  return task.status === 'open' && task.due_date !== null && task.due_date < today
}

/**
 * The brief's order for a task list: overdue first, then priority, then due
 * date (undated last), then newest.
 */
export function sortTasks(tasks: Task[], today = todayChicago()): Task[] {
  return [...tasks].sort((a, b) => {
    const overdue = Number(isOverdue(b, today)) - Number(isOverdue(a, today))
    if (overdue !== 0) return overdue
    const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    if (priority !== 0) return priority
    if (a.due_date !== b.due_date) {
      if (a.due_date === null) return 1
      if (b.due_date === null) return -1
      return a.due_date < b.due_date ? -1 : 1
    }
    return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
  })
}

/** Every open task the signed-in account may see (an artist: only their own). */
export async function loadOpenTasks(): Promise<Task[]> {
  const rows = check(await supabase.from('tasks').select(TASK_COLUMNS).eq('status', 'open'))
  return shape(rows as unknown as TaskRow[])
}

/** Tasks marked done in the last `days` days, newest first. */
export async function loadRecentlyDone(days = 7): Promise<Task[]> {
  const since = `${addDays(todayChicago(), -days)}T00:00:00`
  const rows = check(
    await supabase
      .from('tasks')
      .select(TASK_COLUMNS)
      .eq('status', 'done')
      .gte('completed_at', since)
      .order('completed_at', { ascending: false }),
  )
  return shape(rows as unknown as TaskRow[])
}

/** Open tasks linked to one order. */
export async function loadOrderTasks(orderId: string): Promise<Task[]> {
  const rows = check(await supabase.from('tasks').select(TASK_COLUMNS).eq('status', 'open').eq('order_id', orderId))
  return shape(rows as unknown as TaskRow[])
}

/** Tasks completed between two timestamps (inclusive start, exclusive end). */
export async function loadTasksCompletedBetween(fromIso: string, toIso: string): Promise<Task[]> {
  const rows = check(
    await supabase
      .from('tasks')
      .select(TASK_COLUMNS)
      .eq('status', 'done')
      .gte('completed_at', fromIso)
      .lt('completed_at', toIso)
      .order('completed_at', { ascending: true }),
  )
  return shape(rows as unknown as TaskRow[])
}

/** Fired after any task change, so counts elsewhere on screen can refresh. */
export const TASKS_CHANGED = 'tasks-changed'

function changed() {
  window.dispatchEvent(new Event(TASKS_CHANGED))
}

/** Done for everyone, with who and when recorded.  A recurring task gets its next occurrence. */
export async function completeTask(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('complete_task', { p_task_id: taskId })
  if (error) throw new Error(taskMessage(error.message))
  changed()
}

/** The open occurrence that followed a completed recurring task, if any. */
export async function loadNextOccurrence(taskId: string): Promise<Task | null> {
  const rows = check(await supabase.from('tasks').select(TASK_COLUMNS).eq('previous_task_id', taskId).limit(1))
  const [next] = shape(rows as unknown as TaskRow[])
  return next ?? null
}

// --- Personal list -------------------------------------------------------------

const ITEM_COLUMNS = 'id, owner_id, text, status, task_id, created_at, edited_at'

/** Personal items, newest first.  An artist gets only their own; a manager gets everyone's. */
export async function loadPersonalItems(ownerId?: string): Promise<PersonalItem[]> {
  let query = supabase.from('personal_items').select(ITEM_COLUMNS)
  if (ownerId) query = query.eq('owner_id', ownerId)
  const rows = check(await query.order('created_at', { ascending: false }))
  return rows as PersonalItem[]
}

export async function loadItemOutcomes(): Promise<Map<string, ItemOutcome>> {
  const rows = check(await supabase.rpc('personal_item_outcomes')) as ItemOutcome[]
  return new Map(rows.map((r) => [r.item_id, r]))
}

export async function addPersonalItem(text: string): Promise<void> {
  const { error } = await supabase.from('personal_items').insert({ text })
  if (error) throw new Error(taskMessage(error.message))
}

export async function updatePersonalItem(itemId: string, text: string): Promise<void> {
  const { error, count } = await supabase.from('personal_items').update({ text }, { count: 'exact' }).eq('id', itemId)
  if (error) throw new Error(taskMessage(error.message))
  if (count === 0) throw new Error('This item could not be changed. It may have been removed.')
}

export async function deletePersonalItem(itemId: string): Promise<void> {
  const { error, count } = await supabase.from('personal_items').delete({ count: 'exact' }).eq('id', itemId)
  if (error) throw new Error(taskMessage(error.message))
  if (count === 0) throw new Error('This item could not be removed. It may already be gone.')
}

/** Plain-language versions of the database's task refusals. */
export function taskMessage(message: string): string {
  if (/already done/i.test(message)) return 'Someone already marked this task done. The list has been refreshed.'
  if (/only an assignee or a manager/i.test(message)) return 'Only the people this task is assigned to, or a manager, can mark it done.'
  if (/can no longer be changed/i.test(message)) return 'This item was approved into a task, so it can no longer be changed.'
  if (/row-level security|42501/i.test(message)) return 'Your account is not allowed to make this change.'
  return friendlyDbMessage(message)
}
