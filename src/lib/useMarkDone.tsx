import { useState } from 'react'
import { formatShortDate } from './dates.ts'
import { completeTask, loadNextOccurrence, type Task } from './tasks.ts'

export type TaskMessage = { kind: 'ok' | 'warn'; text: string } | null

/** Marking done with one tap, shared by every task list. */
export function useMarkDone(reload: () => void) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<TaskMessage>(null)

  async function markDone(task: Task) {
    if (busyId) return
    setBusyId(task.id)
    setMessage(null)
    try {
      await completeTask(task.id)
      let text = `Done: “${task.title}”. It is marked done for everyone on it.`
      if (task.recurrence) {
        const next = await loadNextOccurrence(task.id)
        if (next?.due_date) text += ` The next one is due ${formatShortDate(next.due_date)}.`
      }
      setMessage({ kind: 'ok', text })
    } catch (e) {
      setMessage({ kind: 'warn', text: (e as Error).message })
    } finally {
      setBusyId(null)
      reload()
    }
  }

  const notice = message && (
    <p className={message.kind === 'ok' ? 'notice' : 'notice warn'} role="status" style={{ marginTop: 12 }}>
      {message.text}
    </p>
  )
  return { markDone, busyId, setMessage, notice }
}

