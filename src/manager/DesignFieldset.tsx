import type { FormState } from '../lib/useFormState.ts'
import type { DesignValues } from './designForm.ts'

/** The fields shared by the New design form and the design page. */
export default function DesignFieldset({ form }: { form: FormState<DesignValues> }) {
  const { values, set } = form
  return (
    <>
      <label htmlFor="design-name" style={{ marginTop: 0 }}>
        Design name
      </label>
      <input id="design-name" value={values.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" />

      <label htmlFor="design-dimensions">Dimensions</label>
      <textarea id="design-dimensions" value={values.dimensions} onChange={(e) => set('dimensions', e.target.value)} />

      <label htmlFor="design-colors">Colors and finishes</label>
      <textarea id="design-colors" value={values.colors} onChange={(e) => set('colors', e.target.value)} />

      <label htmlFor="design-instructions">Production instructions</label>
      <textarea id="design-instructions" value={values.instructions} onChange={(e) => set('instructions', e.target.value)} />

      <label className="check-row">
        <input type="checkbox" checked={values.hasDabber} onChange={(e) => set('hasDabber', e.target.checked)} />
        Has a matching dabber
      </label>
      <label className="check-row">
        <input type="checkbox" checked={values.isFumed} onChange={(e) => set('isFumed', e.target.checked)} />
        Is fumed
      </label>
    </>
  )
}
