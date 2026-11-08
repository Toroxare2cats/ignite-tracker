import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { useAsync } from '../lib/useAsync.ts'
import { loadDesignPhotos, loadPeople, signedUrl, signedUrls } from '../lib/queries.ts'
import type { Design, DesignPhoto, Person } from '../lib/types.ts'
import { BackLink, ErrorNote, Loading } from '../components/ui.tsx'
import { SaveBar } from '../components/form.tsx'
import { useFormState } from '../lib/useFormState.ts'
import DatedAmountCard from './DatedAmountCard.tsx'
import DesignFieldset from './DesignFieldset.tsx'
import { designFields, designValues } from './designForm.ts'
import {
  addDesignPrice,
  addReferencePhoto,
  loadDesign,
  loadDesignPrices,
  PHOTO_ACCEPT,
  photoProblem,
  removeProductImage,
  removeReferencePhoto,
  setProductImage,
  updateDesign,
  type DesignPrice,
} from './queries.ts'

interface Data {
  design: Design | null
  prices: DesignPrice[]
  photos: DesignPhoto[]
  people: Map<string, Person>
  imageUrl: string | null
  photoUrls: Map<string, string>
}

/**
 * One design: its details, its selling price and its photos.  Each card saves
 * on its own, so adding a photo never disturbs unsaved edits to the details.
 */
export default function DesignScreen() {
  const { designId = '' } = useParams()
  const location = useLocation()
  const [notice] = useState<string | null>((location.state as { saved?: string } | null)?.saved ?? null)

  const { state, reload } = useAsync<Data>(async () => {
    const design = await loadDesign(designId)
    if (!design) return { design: null, prices: [], photos: [], people: new Map(), imageUrl: null, photoUrls: new Map() }
    const [prices, photos, people, imageUrl] = await Promise.all([
      loadDesignPrices(designId),
      loadDesignPhotos(designId),
      loadPeople(),
      design.product_image_path ? signedUrl('design-photos', design.product_image_path) : Promise.resolve(null),
    ])
    const photoUrls = await signedUrls(
      'design-photos',
      photos.map((p) => p.storage_path),
    )
    return { design, prices, photos, people, imageUrl, photoUrls }
  }, [designId])

  if (state.kind === 'loading') return <Loading what="the design" />
  if (state.kind === 'error') return <ErrorNote message={state.message} onRetry={reload} />

  const { design, prices, photos, people, imageUrl, photoUrls } = state.data
  if (!design) {
    return (
      <>
        <BackLink to="/manage/designs" label="Designs" />
        <p>This design could not be found.</p>
      </>
    )
  }

  return (
    <>
      <BackLink to="/manage/designs" label="Designs" />
      <div className="topbar">
        <h1>{design.name}</h1>
      </div>
      {notice && <p className="notice">{notice}</p>}
      {!design.active && <p className="notice warn">This design is retired. It cannot be chosen for new orders; orders already made from it are not affected.</p>}

      <div className="portal-columns">
        <div>
          <DetailsCard key={design.id} design={design} onSaved={reload} />
        </div>
        <div>
          <DatedAmountCard
            title="Selling price per bottle"
            noun="price"
            testId="price"
            newLabel="New price ($)"
            example="5.00"
            note="Prices are never overwritten. To correct a mistake, add a new price with the same date; the newest one counts."
            rows={prices.map((p) => ({ ...p, amount: p.price_per_bottle }))}
            people={people}
            onAdd={(amount, from) => addDesignPrice(design.id, amount, from)}
            onSaved={reload}
          />
          <PhotosCard design={design} photos={photos} imageUrl={imageUrl} photoUrls={photoUrls} onChanged={reload} />
        </div>
      </div>
    </>
  )
}

function DetailsCard({ design, onSaved }: { design: Design; onSaved: () => void }) {
  const form = useFormState(designValues(design))
  const { values, set } = form

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (values.name.trim() === '') return form.fail('Give the design a name.')
    const ok = await form.submit(async (v) => {
      await updateDesign(design.id, designFields(v))
    })
    if (ok) onSaved()
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="card">
      <DesignFieldset form={form} />
      <p className="form-note">
        Text changes apply to new orders; orders already created keep their own copy. The dabber and fumed boxes apply to every order of this design straight away, including orders in progress.
      </p>
      <label className="check-row">
        <input type="checkbox" checked={values.active} onChange={(e) => set('active', e.target.checked)} />
        Active (can be chosen for new orders)
      </label>
      <SaveBar form={form} />
    </form>
  )
}

function PhotosCard({
  design,
  photos,
  imageUrl,
  photoUrls,
  onChanged,
}: {
  design: Design
  photos: DesignPhoto[]
  imageUrl: string | null
  photoUrls: Map<string, string>
  onChanged: () => void
}) {
  const nextOrder = photos.reduce((highest, p) => Math.max(highest, p.sort_order), -1) + 1

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Product image</h3>
      {design.product_image_path ? (
        <>
          {imageUrl ? <img className="product-image" src={imageUrl} alt={`${design.name} product`} /> : <p className="muted small">This image could not be loaded.</p>}
          <RemovePhoto
            what="product image"
            onRemove={async () => {
              await removeProductImage(design)
              onChanged()
            }}
          />
        </>
      ) : (
        <p className="muted small">No product image. Orders work fine without one.</p>
      )}
      <PhotoForm
        id="product-photo"
        label={design.product_image_path ? 'Replace the product image' : 'Choose a product image'}
        saveLabel="Upload image"
        onUpload={async (file) => {
          await setProductImage(design, file)
          onChanged()
        }}
      />

      <h3>Reference photos</h3>
      <p className="form-note">Photos stay on the design, so artists see them on every order of it.</p>
      {photos.length === 0 && <p className="muted small">No reference photos yet.</p>}
      {photos.length > 0 && (
        <div className="photos">
          {photos.map((p) => {
            const url = photoUrls.get(p.storage_path)
            return (
              <figure key={p.id} style={{ margin: 0 }}>
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt={p.caption ?? 'Reference photo'} loading="lazy" />
                  </a>
                ) : (
                  <p className="muted small">This photo could not be loaded.</p>
                )}
                {p.caption && <figcaption>{p.caption}</figcaption>}
                <RemovePhoto
                  what="photo"
                  onRemove={async () => {
                    await removeReferencePhoto(p)
                    onChanged()
                  }}
                />
              </figure>
            )
          })}
        </div>
      )}
      <PhotoForm
        id="reference-photo"
        label="Add a reference photo"
        saveLabel="Upload photo"
        withCaption
        onUpload={async (file, caption) => {
          await addReferencePhoto(design.id, file, caption, nextOrder)
          onChanged()
        }}
      />
    </div>
  )
}

/** Choose a file, then press the button.  The file name tracks unsaved state because a File cannot be compared. */
function PhotoForm({
  id,
  label,
  saveLabel,
  withCaption = false,
  onUpload,
}: {
  id: string
  label: string
  saveLabel: string
  withCaption?: boolean
  onUpload: (file: File, caption: string | null) => Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const form = useFormState({ fileName: '', caption: '' })
  const { values, set } = form

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null
    setFile(chosen)
    set('fileName', chosen?.name ?? '')
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!file) return form.fail('Choose a photo first.')
    const problem = photoProblem(file)
    if (problem) return form.fail(problem)
    const ok = await form.submit(async (v) => {
      await onUpload(file, v.caption.trim() === '' ? null : v.caption.trim())
      return { fileName: '', caption: '' }
    })
    if (ok) {
      setFile(null)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <label htmlFor={id}>{label}</label>
      <input id={id} ref={input} type="file" accept={PHOTO_ACCEPT} onChange={choose} />
      {withCaption && (
        <>
          <label htmlFor={`${id}-caption`}>Caption (optional)</label>
          <input id={`${id}-caption`} value={values.caption} onChange={(e) => set('caption', e.target.value)} autoComplete="off" />
        </>
      )}
      <SaveBar form={form} saveLabel={saveLabel} savingLabel="Uploading…" requireChanges={false} cleanText="JPEG, PNG or WebP, up to 10 MB" />
    </form>
  )
}

/** Asks once before removing, because a photo shows on every order of the design. */
function RemovePhoto({ what, onRemove }: { what: string; onRemove: () => Promise<void> }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await onRemove()
      setAsking(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!asking) {
    return (
      <button type="button" className="photo-action" onClick={() => setAsking(true)}>
        Remove {what}
      </button>
    )
  }
  return (
    <div className="photo-confirm">
      <span className="small">It disappears from every order of this design.</span>
      <button type="button" className="photo-action" onClick={remove} disabled={busy}>
        {busy ? 'Removing…' : 'Yes, remove'}
      </button>
      <button type="button" className="photo-action keep" onClick={() => setAsking(false)} disabled={busy}>
        Keep it
      </button>
      {error && <p className="save-status error">{error}</p>}
    </div>
  )
}
