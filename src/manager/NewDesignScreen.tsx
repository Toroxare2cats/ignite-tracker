import { useRef, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BackLink } from '../components/ui.tsx'
import { SaveBar } from '../components/form.tsx'
import { useFormState } from '../lib/useFormState.ts'
import DesignFieldset from './DesignFieldset.tsx'
import { BLANK_DESIGN, designFields } from './designForm.ts'
import { createDesign } from './queries.ts'

/**
 * A new design.  The selling price and photos are added on the design's own
 * page straight after, because each one is saved separately.
 */
export default function NewDesignScreen() {
  const navigate = useNavigate()
  const newId = useRef('')
  const form = useFormState(BLANK_DESIGN)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (form.values.name.trim() === '') return form.fail('Give the design a name.')
    const ok = await form.submit(async (values) => {
      newId.current = await createDesign(designFields(values))
    })
    if (ok) navigate(`/manage/designs/${newId.current}`, { replace: true, state: { saved: 'Design created. Add its selling price and photos below.' } })
  }

  return (
    <>
      <BackLink to="/manage/designs" label="Designs" />
      <h1>New design</h1>
      <form onSubmit={handleSubmit} noValidate className="card form-card">
        <DesignFieldset form={form} />
        <p className="form-note">You can add the selling price and photos on the next page.</p>
        <SaveBar form={form} saveLabel="Create design" requireChanges={false} cleanText="Not saved yet">
          <Link to="/manage/designs" className="btn secondary">
            Cancel
          </Link>
        </SaveBar>
      </form>
    </>
  )
}
