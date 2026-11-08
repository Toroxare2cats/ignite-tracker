import { useRef, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAsync } from '../lib/useAsync.ts'
import { loadOrder, loadPeople } from '../lib/queries.ts'
import { addDays, todayChicago } from '../lib/dates.ts'
import type { Design, OrderWithDesign, Person } from '../lib/types.ts'
import { BackLink, ErrorNote, Loading } from '../components/ui.tsx'
import { SaveBar } from '../components/form.tsx'
import { useFormState } from '../lib/useFormState.ts'
import { blankToNull, parseCount } from './format.ts'
import { createOrder, loadActiveDesigns, updateOrder } from './queries.ts'

interface Data {
  order: OrderWithDesign | null
  designs: Design[]
  people: Person[]
}

/** Create a new order from a design, or edit one that already exists. */
export default function OrderFormScreen() {
  const { orderId } = useParams()
  const editing = Boolean(orderId)

  const { state, reload } = useAsync<Data>(async () => {
    const [order, designs, people] = await Promise.all([
      orderId ? loadOrder(orderId) : Promise.resolve(null),
      loadActiveDesigns(),
      loadPeople(),
    ])
    const list = [...people.values()].sort((a, b) => a.full_name.localeCompare(b.full_name))
    return { order, designs, people: list }
  }, [orderId])

  const back = orderId ? `/manage/orders/${orderId}` : '/manage/orders'

  if (state.kind === 'loading') return <Loading what="the order form" />
  if (state.kind === 'error') return <ErrorNote message={state.message} onRetry={reload} />
  if (editing && !state.data.order) {
    return (
      <>
        <BackLink to="/manage/orders" label="Orders" />
        <p>This order could not be found.</p>
      </>
    )
  }
  if (state.data.order?.status === 'closed') {
    return (
      <>
        <BackLink to={back} label={state.data.order.name} />
        <p className="notice warn">This order is closed. Reopen it before changing its details.</p>
      </>
    )
  }

  return <OrderForm key={orderId ?? 'new'} data={state.data} backTo={back} />
}

function OrderForm({ data, backTo }: { data: Data; backTo: string }) {
  const navigate = useNavigate()
  const newId = useRef('')
  const { order, designs, people } = data
  const form = useFormState({
    name: order?.name ?? '',
    designId: order?.design_id ?? '',
    bottles: order ? String(order.bottles_ordered) : '',
    dabbers: order ? String(order.dabbers_ordered) : '',
    dueDate: order?.due_date ?? '',
    primaryId: order?.primary_artist_id ?? '',
    specDimensions: order?.spec_dimensions ?? '',
    specColors: order?.spec_colors_finishes ?? '',
    specInstructions: order?.spec_instructions ?? '',
  })
  const { values, set } = form

  // An order's design is fixed once created; show it even if since retired.
  const design = order ? order.design : designs.find((d) => d.id === values.designId)
  // A deactivated person stays selectable only while they are the current primary artist.
  const choices = people.filter((p) => p.active || p.id === order?.primary_artist_id)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const name = values.name.trim()
    const bottles = parseCount(values.bottles)
    const dabbers = design?.has_dabber ? parseCount(values.dabbers === '' ? '0' : values.dabbers) : 0

    if (name === '') return form.fail('Give the order a name or number.')
    if (!order && !values.designId) return form.fail('Choose the design this order is a run of.')
    if (bottles === null) return form.fail('Enter the number of bottles ordered as a whole number.')
    if (dabbers === null) return form.fail('Enter the number of dabbers ordered as a whole number.')
    if (bottles === 0 && dabbers === 0) return form.fail('Enter a quantity above zero.')
    if (!values.dueDate) return form.fail('Choose a due date.')
    if (!values.primaryId) return form.fail('Choose a primary artist.')

    if (order) {
      const ok = await form.submit(async () => {
        await updateOrder(order.id, {
          name,
          bottles_ordered: bottles,
          dabbers_ordered: dabbers,
          due_date: values.dueDate,
          primary_artist_id: values.primaryId,
          spec_dimensions: blankToNull(values.specDimensions),
          spec_colors_finishes: blankToNull(values.specColors),
          spec_instructions: blankToNull(values.specInstructions),
        })
      })
      if (ok) navigate(backTo, { state: { saved: 'Order saved.' } })
      return
    }

    const ok = await form.submit(async () => {
      newId.current = await createOrder({
        name,
        design_id: values.designId,
        bottles_ordered: bottles,
        dabbers_ordered: dabbers,
        due_date: values.dueDate,
        primary_artist_id: values.primaryId,
      })
    })
    if (ok) navigate(`/manage/orders/${newId.current}`, { replace: true, state: { saved: 'Order created. The design’s specifications were copied onto it.' } })
  }

  return (
    <>
      <BackLink to={backTo} label={order ? order.name : 'Orders'} />
      <h1>{order ? 'Edit order' : 'New order'}</h1>

      <form onSubmit={handleSubmit} noValidate className="card form-card">
        <label htmlFor="order-name" style={{ marginTop: 0 }}>
          Order name or number
        </label>
        <input id="order-name" value={values.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" />

        {order ? (
          <>
            <label>Design</label>
            <p className="plain-value">{order.design.name}</p>
          </>
        ) : (
          <>
            <label htmlFor="order-design">Design</label>
            <select id="order-design" value={values.designId} onChange={(e) => set('designId', e.target.value)}>
              <option value="">Choose a design…</option>
              {designs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </>
        )}

        <div className="two-up">
          <div>
            <label htmlFor="order-bottles">Bottles ordered</label>
            <input id="order-bottles" inputMode="numeric" value={values.bottles} onChange={(e) => set('bottles', e.target.value)} autoComplete="off" />
          </div>
          {design?.has_dabber && (
            <div>
              <label htmlFor="order-dabbers">Dabbers ordered</label>
              <input id="order-dabbers" inputMode="numeric" value={values.dabbers} onChange={(e) => set('dabbers', e.target.value)} autoComplete="off" />
            </div>
          )}
        </div>

        <div className="two-up">
          <div>
            <label htmlFor="order-due">Due date</label>
            <input id="order-due" type="date" min={order ? undefined : addDays(todayChicago(), -365)} value={values.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </div>
          <div>
            <label htmlFor="order-primary">Primary artist</label>
            <select id="order-primary" value={values.primaryId} onChange={(e) => set('primaryId', e.target.value)}>
              <option value="">Choose a person…</option>
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!order && design && (
          <div className="spec-preview">
            <p className="form-note">These specifications are copied onto the order when you save. You can change the order’s copy afterwards; the design stays as it is.</p>
            <SpecLine title="Dimensions" text={design.dimensions} />
            <SpecLine title="Colors and finishes" text={design.colors_finishes} />
            <SpecLine title="Instructions" text={design.instructions} />
          </div>
        )}

        {order && (
          <>
            <h3>This order’s specifications</h3>
            <p className="form-note">These were copied from the design. Changes here apply to this run only; the design and other orders stay as they are.</p>
            <label htmlFor="spec-dimensions">Dimensions</label>
            <textarea id="spec-dimensions" value={values.specDimensions} onChange={(e) => set('specDimensions', e.target.value)} />
            <label htmlFor="spec-colors">Colors and finishes</label>
            <textarea id="spec-colors" value={values.specColors} onChange={(e) => set('specColors', e.target.value)} />
            <label htmlFor="spec-instructions">Instructions</label>
            <textarea id="spec-instructions" value={values.specInstructions} onChange={(e) => set('specInstructions', e.target.value)} />
          </>
        )}

        <SaveBar form={form} saveLabel={order ? 'Save changes' : 'Create order'} requireChanges={Boolean(order)} cleanText={order ? 'No changes yet' : 'Not saved yet'}>
          <Link to={backTo} className="btn secondary">
            Cancel
          </Link>
        </SaveBar>
      </form>
    </>
  )
}

function SpecLine({ title, text }: { title: string; text: string | null }) {
  return (
    <p className="small" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>
      <strong>{title}:</strong> {text ?? <span className="muted">None on the design</span>}
    </p>
  )
}
