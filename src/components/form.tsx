import { type ReactNode } from 'react'
import { formatStamp } from '../lib/dates.ts'
import type { FormState } from '../lib/useFormState.ts'

/** The one line that says where a form stands: unsaved, saving, saved or failed. */
export function SaveStatusLine({
  form,
  cleanText = 'No changes yet',
}: {
  form: Pick<FormState<unknown>, 'status' | 'error' | 'dirty' | 'savedAt'>
  cleanText?: string
}) {
  let kind = 'clean'
  let text = cleanText
  if (form.status === 'saving') {
    kind = 'saving'
    text = 'Saving…'
  } else if (form.status === 'error') {
    kind = 'error'
    text = `Not saved. ${form.error ?? ''} What you typed is still here.`
  } else if (form.dirty) {
    kind = 'dirty'
    text = 'Unsaved changes'
  } else if (form.status === 'saved' && form.savedAt) {
    kind = 'saved'
    text = `Saved ${formatStamp(form.savedAt)}`
  }
  return (
    <p className={`save-status ${kind}`} role="status" aria-live="polite">
      {text}
    </p>
  )
}

/**
 * The status line and the save button, used at the foot of every form.
 * `requireChanges` keeps the button off until something has changed; forms
 * that perform an action (Finish, Close, Reopen) turn it off.
 */
export function SaveBar<T>({
  form,
  saveLabel = 'Save changes',
  savingLabel = 'Saving…',
  requireChanges = true,
  cleanText,
  danger = false,
  children,
}: {
  form: FormState<T>
  saveLabel?: string
  savingLabel?: string
  requireChanges?: boolean
  cleanText?: string
  danger?: boolean
  children?: ReactNode
}) {
  const saving = form.status === 'saving'
  return (
    <div className="savebar">
      <SaveStatusLine form={form} cleanText={cleanText} />
      <div className="savebar-actions">
        {children}
        <button type="submit" className={danger ? 'danger' : undefined} disabled={saving || (requireChanges && !form.dirty)}>
          {saving ? savingLabel : saveLabel}
        </button>
      </div>
    </div>
  )
}
