/**
 * Every read and write the artist screens make.  Row-level security in the
 * database decides what each account actually gets back; these functions only
 * shape the requests and the results.
 */
import { supabase } from './supabase.ts'
import type {
  Counts,
  Design,
  DesignPhoto,
  Entry,
  EntryWithTime,
  Order,
  OrderWithDesign,
  Person,
  Purchase,
} from './types.ts'

export const ORDER_COLUMNS =
  'id, name, design_id, bottles_ordered, dabbers_ordered, due_date, primary_artist_id, status, ' +
  'spec_dimensions, spec_colors_finishes, spec_instructions, finished_by, finished_at, ' +
  'packing_note, box_length, box_width, box_height, box_weight, created_at'

export const DESIGN_COLUMNS =
  'id, name, product_image_path, dimensions, colors_finishes, instructions, has_dabber, is_fumed, active'

const ENTRY_COLUMNS =
  'id, order_id, artist_id, work_date, bottles, dabbers, points, color_tube_preps, blanks, fuming, note, created_at, edited_by, edited_at'

export function check<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('No data returned')
  return result.data
}

// --- People -----------------------------------------------------------------

/** Names and roles of everyone (the `people` view), keyed by id. */
export async function loadPeople(): Promise<Map<string, Person>> {
  const rows = check(await supabase.from('people').select('id, full_name, role, active'))
  return new Map((rows as Person[]).map((p) => [p.id, p]))
}

// --- Orders -----------------------------------------------------------------

/** Every order that is not closed, with its design, soonest due date first. */
export async function loadOpenOrders(): Promise<OrderWithDesign[]> {
  const rows = check(
    await supabase
      .from('orders')
      .select(`${ORDER_COLUMNS}, design:designs(${DESIGN_COLUMNS})`)
      .neq('status', 'closed')
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
  )
  return rows as unknown as OrderWithDesign[]
}

export async function loadOrder(orderId: string): Promise<OrderWithDesign | null> {
  const { data, error } = await supabase
    .from('orders')
    .select(`${ORDER_COLUMNS}, design:designs(${DESIGN_COLUMNS})`)
    .eq('id', orderId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as OrderWithDesign | null) ?? null
}

/** Anyone signed in may mark an open order Finished; who and when are recorded. */
export async function finishOrder(
  orderId: string,
  details: { packingNote: string | null; boxLength: number | null; boxWidth: number | null; boxHeight: number | null; boxWeight: number | null },
): Promise<void> {
  const { error } = await supabase.rpc('finish_order', {
    p_order_id: orderId,
    p_packing_note: details.packingNote,
    p_box_length: details.boxLength,
    p_box_width: details.boxWidth,
    p_box_height: details.boxHeight,
    p_box_weight: details.boxWeight,
  })
  if (error) throw new Error(friendlyDbMessage(error.message))
}

/** Orders the person has logged an entry on since `sinceDate`, most recent first. */
export async function loadRecentOrderIds(artistId: string, sinceDate: string): Promise<string[]> {
  const rows = check(
    await supabase
      .from('entries')
      .select('order_id, work_date')
      .eq('artist_id', artistId)
      .gte('work_date', sinceDate)
      .order('work_date', { ascending: false }),
  ) as { order_id: string; work_date: string }[]
  const seen = new Set<string>()
  const ids: string[] = []
  for (const r of rows) {
    if (!seen.has(r.order_id)) {
      seen.add(r.order_id)
      ids.push(r.order_id)
    }
  }
  return ids
}

/** Open tasks assigned to the person.  Returns null when the count cannot be read. */
export async function countOpenTasks(profileId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from('task_assignees')
    .select('task_id, tasks!inner(status)', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('tasks.status', 'open')
  if (error) return null
  return count ?? 0
}

// --- Designs and photos -----------------------------------------------------

export async function loadDesignPhotos(designId: string): Promise<DesignPhoto[]> {
  const rows = check(
    await supabase
      .from('design_photos')
      .select('id, design_id, storage_path, caption, sort_order')
      .eq('design_id', designId)
      .order('sort_order', { ascending: true }),
  )
  return rows as DesignPhoto[]
}

/** A short-lived link to a private file, or null if it cannot be made. */
export async function signedUrl(bucket: 'design-photos' | 'receipts', path: string, seconds = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds)
  if (error || !data) return null
  return data.signedUrl
}

export async function signedUrls(bucket: 'design-photos' | 'receipts', paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (paths.length === 0) return out
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, 3600)
  if (error || !data) return out
  for (const item of data) {
    if (item.path && item.signedUrl) out.set(item.path, item.signedUrl)
  }
  return out
}

// --- Entries ----------------------------------------------------------------

/**
 * Attach minutes to entries.  Row-level security on entry_time returns rows
 * only for the signed-in person's own entries (or all of them for a manager),
 * so anything missing here is simply not ours to see.
 */
async function attachTime(entries: Entry[]): Promise<EntryWithTime[]> {
  if (entries.length === 0) return []
  const ids = entries.map((e) => e.id)
  const rows = check(await supabase.from('entry_time').select('entry_id, minutes').in('entry_id', ids)) as {
    entry_id: string
    minutes: number
  }[]
  const minutesById = new Map(rows.map((r) => [r.entry_id, r.minutes]))
  return entries.map((e) => ({ ...e, minutes: minutesById.get(e.id) ?? null }))
}

/** The shared work log of an order, newest work date first. */
export async function loadOrderEntries(orderId: string): Promise<EntryWithTime[]> {
  const rows = check(
    await supabase
      .from('entries')
      .select(ENTRY_COLUMNS)
      .eq('order_id', orderId)
      .order('work_date', { ascending: false })
      .order('created_at', { ascending: false }),
  ) as Entry[]
  return attachTime(rows)
}

export async function loadEntry(entryId: string): Promise<EntryWithTime | null> {
  const { data, error } = await supabase.from('entries').select(ENTRY_COLUMNS).eq('id', entryId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const [entry] = await attachTime([data as Entry])
  return entry
}

/** The person's own entry on an order for one work date, if there is one. */
export async function findOwnEntry(orderId: string, artistId: string, workDate: string): Promise<EntryWithTime | null> {
  const { data, error } = await supabase
    .from('entries')
    .select(ENTRY_COLUMNS)
    .eq('order_id', orderId)
    .eq('artist_id', artistId)
    .eq('work_date', workDate)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const [entry] = await attachTime([data as Entry])
  return entry
}

/** The person's own entries between two dates (inclusive), oldest first. */
export async function loadOwnEntries(artistId: string, fromDate: string, toDate: string): Promise<EntryWithTime[]> {
  const rows = check(
    await supabase
      .from('entries')
      .select(ENTRY_COLUMNS)
      .eq('artist_id', artistId)
      .gte('work_date', fromDate)
      .lte('work_date', toDate)
      .order('work_date', { ascending: true })
      .order('created_at', { ascending: true }),
  ) as Entry[]
  return attachTime(rows)
}

export interface EntryInput extends Counts {
  order_id: string
  artist_id: string
  work_date: string
  note: string | null
  minutes: number
}

/** True when a Postgres error means "that row already exists". */
function isDuplicate(error: { code?: string; message: string }): boolean {
  return error.code === '23505' || /duplicate key/i.test(error.message)
}

/**
 * Save a new entry and its minutes.  One entry per artist, per order, per day
 * is enforced by the database; if the same day is saved twice (a repeated tap,
 * or a second phone) the existing entry is updated instead of duplicated.
 * Returns the saved entry id.
 */
export async function createEntry(input: EntryInput): Promise<string> {
  const { minutes, ...entry } = input
  const inserted = await supabase.from('entries').insert(entry).select('id').single()
  if (inserted.error) {
    if (!isDuplicate(inserted.error)) throw new Error(friendlyDbMessage(inserted.error.message))
    const existing = await findOwnEntry(entry.order_id, entry.artist_id, entry.work_date)
    if (!existing) throw new Error(inserted.error.message)
    const { order_id: _o, artist_id: _a, ...changes } = entry
    await updateEntry(existing.id, changes, minutes)
    return existing.id
  }
  const entryId = (inserted.data as { id: string }).id
  await saveMinutes(entryId, minutes)
  return entryId
}

export async function updateEntry(
  entryId: string,
  changes: Counts & { note: string | null; work_date?: string },
  minutes: number,
): Promise<void> {
  const { error, count } = await supabase.from('entries').update(changes, { count: 'exact' }).eq('id', entryId)
  if (error) throw new Error(friendlyDbMessage(error.message))
  if (count === 0) throw new Error(EDIT_WINDOW_MESSAGE)
  await saveMinutes(entryId, minutes)
}

async function saveMinutes(entryId: string, minutes: number): Promise<void> {
  const { error } = await supabase.from('entry_time').upsert({ entry_id: entryId, minutes }, { onConflict: 'entry_id' })
  if (error) throw new Error(friendlyDbMessage(error.message))
}

export async function deleteEntry(entryId: string): Promise<void> {
  // entry_time goes with it (on delete cascade).
  const { error, count } = await supabase.from('entries').delete({ count: 'exact' }).eq('id', entryId)
  if (error) throw new Error(friendlyDbMessage(error.message))
  if (count === 0) throw new Error(EDIT_WINDOW_MESSAGE)
}

export const EDIT_WINDOW_MESSAGE =
  'This entry could not be changed. Entries can be edited for 7 days after the work date; after that, ask a manager.'

/** Turns the database's refusal messages into plain language. */
export function friendlyDbMessage(message: string): string {
  if (/closed; a manager must reopen/i.test(message)) {
    return 'This order is closed. A manager must reopen it before entries can change.'
  }
  if (/row-level security/i.test(message)) {
    return EDIT_WINDOW_MESSAGE
  }
  if (/fetch|network/i.test(message)) {
    return 'Could not reach the server. Check your connection and try again; what you typed is still here.'
  }
  return message
}

// --- Purchases --------------------------------------------------------------

const PURCHASE_COLUMNS =
  'id, artist_id, order_id, for_stock, description, amount, receipt_path, status, decided_at, decision_reason, created_at, order:orders(name)'

/** A person's own submission, with the order's name even after that order closes. */
export interface OwnPurchase extends Purchase {
  order: { name: string } | null
}

/** The signed-in person's own submissions (row-level security hides everyone else's). */
export async function loadOwnPurchases(artistId: string): Promise<OwnPurchase[]> {
  const rows = check(
    await supabase.from('purchases').select(PURCHASE_COLUMNS).eq('artist_id', artistId).order('created_at', { ascending: false }),
  )
  return rows as unknown as OwnPurchase[]
}

export interface PurchaseInput {
  artist_id: string
  description: string
  amount: number
  order_id: string | null
  for_stock: boolean
  receipt: File | null
}

export async function submitPurchase(input: PurchaseInput): Promise<void> {
  let receipt_path: string | null = null
  if (input.receipt) {
    const safeName = input.receipt.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-60) || 'receipt'
    receipt_path = `${input.artist_id}/${Date.now()}-${safeName}`
    const { error } = await supabase.storage.from('receipts').upload(receipt_path, input.receipt, {
      contentType: input.receipt.type || undefined,
      upsert: false,
    })
    if (error) throw new Error(`The receipt photo could not be uploaded: ${error.message}`)
  }
  const { error } = await supabase.from('purchases').insert({
    artist_id: input.artist_id,
    description: input.description,
    amount: input.amount,
    order_id: input.order_id,
    for_stock: input.for_stock,
    receipt_path,
  })
  if (error) throw new Error(friendlyDbMessage(error.message))
  window.dispatchEvent(new Event(PURCHASES_CHANGED))
}

/** Fired when a purchase is submitted or decided, so the menu's count stays right. */
export const PURCHASES_CHANGED = 'purchases-changed'

/** Purchases waiting for a decision.  Null when the count cannot be read. */
export async function countPendingPurchases(): Promise<number | null> {
  const { count, error } = await supabase.from('purchases').select('id', { count: 'exact', head: true }).eq('status', 'pending')
  if (error) return null
  return count ?? 0
}

export type { Design, Order }
