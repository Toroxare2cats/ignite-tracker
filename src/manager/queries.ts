/**
 * Reads and writes used only by the manager portal.  Row-level security and
 * the role checks inside the database functions decide what an account gets;
 * an artist account calling any of these receives nothing or a refusal.
 */
import { supabase } from '../lib/supabase.ts'
import { check, DESIGN_COLUMNS, friendlyDbMessage, ORDER_COLUMNS, PURCHASES_CHANGED } from '../lib/queries.ts'
import type { Role } from '../lib/profile.ts'
import type { Design, DesignPhoto, OrderStatus, OrderWithDesign, Purchase } from '../lib/types.ts'

// --- Orders -----------------------------------------------------------------

/** Every order with its design, soonest due date first (no due date last). */
export async function loadAllOrders(): Promise<OrderWithDesign[]> {
  const rows = check(
    await supabase
      .from('orders')
      .select(`${ORDER_COLUMNS}, design:designs(${DESIGN_COLUMNS})`)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
  )
  return rows as unknown as OrderWithDesign[]
}

export interface NewOrder {
  name: string
  design_id: string
  bottles_ordered: number
  dabbers_ordered: number
  due_date: string
  primary_artist_id: string
}

/** The database copies the design's text specifications onto the new order. */
export async function createOrder(order: NewOrder): Promise<string> {
  const { data, error } = await supabase.from('orders').insert(order).select('id').single()
  if (error) throw new Error(friendlyDbMessage(error.message))
  return (data as { id: string }).id
}

export interface OrderChanges {
  name: string
  bottles_ordered: number
  dabbers_ordered: number
  due_date: string
  primary_artist_id: string
  spec_dimensions: string | null
  spec_colors_finishes: string | null
  spec_instructions: string | null
}

export async function updateOrder(orderId: string, changes: OrderChanges): Promise<void> {
  const { error, count } = await supabase.from('orders').update(changes, { count: 'exact' }).eq('id', orderId)
  if (error) throw new Error(friendlyDbMessage(error.message))
  if (count === 0) throw new Error('This order could not be changed. Refresh the page and try again.')
}

export interface CloseDetails {
  bottlesDelivered: number
  dabbersDelivered: number
  sellingPrice: number
  materialsTotal: number
  materialsNote: string | null
}

export async function closeOrder(orderId: string, d: CloseDetails): Promise<void> {
  const { error } = await supabase.rpc('close_order', {
    p_order_id: orderId,
    p_bottles_delivered: d.bottlesDelivered,
    p_dabbers_delivered: d.dabbersDelivered,
    p_selling_price: d.sellingPrice,
    p_materials_total: d.materialsTotal,
    p_materials_note: d.materialsNote,
  })
  if (error) throw new Error(friendlyDbMessage(error.message))
}

export async function reopenOrder(orderId: string, reason: string | null): Promise<void> {
  const { error } = await supabase.rpc('reopen_order', { p_order_id: orderId, p_reason: reason })
  if (error) throw new Error(friendlyDbMessage(error.message))
}

// --- History ----------------------------------------------------------------

export type OrderEventType = 'created' | 'finished' | 'closed' | 'reopened' | 'reassigned'

export interface OrderEvent {
  id: string
  event_type: OrderEventType
  actor_id: string | null
  occurred_at: string
  reason: string | null
  details: {
    packing_note?: string
    box_length?: number
    box_width?: number
    box_height?: number
    box_weight?: number
    previous_status?: OrderStatus
    finished_by?: string
    finished_at?: string
    from?: string
    to?: string
  }
}

/** Newest first. */
export async function loadOrderEvents(orderId: string): Promise<OrderEvent[]> {
  const rows = check(
    await supabase
      .from('order_events')
      .select('id, event_type, actor_id, occurred_at, reason, details')
      .eq('order_id', orderId)
      .order('occurred_at', { ascending: false }),
  )
  return rows as OrderEvent[]
}

export interface FinancialSnapshot {
  bottles_delivered: number | null
  dabbers_delivered: number | null
  selling_price: number | null
  materials_total: number | null
  materials_note: string | null
  closed_by: string | null
  closed_at: string | null
}

export interface FinancialHistoryRow {
  id: string
  snapshot: FinancialSnapshot
  recorded_at: string
}

/** The financial figures as they stood each time a closed order was reopened. */
export async function loadFinancialHistory(orderId: string): Promise<FinancialHistoryRow[]> {
  const rows = check(
    await supabase.from('order_financial_history').select('id, snapshot, recorded_at').eq('order_id', orderId),
  )
  return rows as FinancialHistoryRow[]
}

// --- Money on one order -----------------------------------------------------

export interface OrderFinancials {
  order_id: string
  bottles_delivered: number | null
  dabbers_delivered: number | null
  selling_price: number | null
  materials_total: number | null
  materials_note: string | null
  closed_by: string | null
  closed_at: string | null
}

export async function loadOrderFinancials(orderId: string): Promise<OrderFinancials | null> {
  const { data, error } = await supabase
    .from('order_financials')
    .select('order_id, bottles_delivered, dabbers_delivered, selling_price, materials_total, materials_note, closed_by, closed_at')
    .eq('order_id', orderId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as OrderFinancials | null) ?? null
}

/** The manager-entered materials total and its short note. */
export async function saveMaterials(orderId: string, materialsTotal: number | null, materialsNote: string | null): Promise<void> {
  const { error } = await supabase
    .from('order_financials')
    .upsert({ order_id: orderId, materials_total: materialsTotal, materials_note: materialsNote }, { onConflict: 'order_id' })
  if (error) throw new Error(friendlyDbMessage(error.message))
}

export interface OrderCost {
  total_minutes: number
  labor_cost: number | null
  materials_cost: number | null
  recorded_cost: number | null
  selling_price: number | null
  amount_remaining: number | null
  bottles_delivered: number | null
  minutes_per_bottle: number | null
  cost_per_bottle: number | null
  price_per_bottle: number | null
  remaining_per_bottle: number | null
  missing: string[]
}

export async function loadOrderCost(orderId: string): Promise<OrderCost | null> {
  const rows = check(await supabase.rpc('order_cost', { p_order_id: orderId })) as OrderCost[]
  return rows[0] ?? null
}

export interface OrderPurchase {
  id: string
  artist_id: string
  description: string
  amount: number
  status: 'pending' | 'approved' | 'rejected'
}

export async function loadOrderPurchases(orderId: string): Promise<OrderPurchase[]> {
  const rows = check(
    await supabase
      .from('purchases')
      .select('id, artist_id, description, amount, status')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true }),
  )
  return rows as OrderPurchase[]
}

export interface OrderAllocation {
  id: string
  amount: number
  note: string | null
  purchase: { description: string } | null
}

export async function loadOrderAllocations(orderId: string): Promise<OrderAllocation[]> {
  const rows = check(
    await supabase
      .from('stock_allocations')
      .select('id, amount, note, purchase:purchases(description)')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true }),
  )
  return rows as unknown as OrderAllocation[]
}

// --- Designs ----------------------------------------------------------------

/** Designs that can be chosen for a new order. */
export async function loadActiveDesigns(): Promise<Design[]> {
  const rows = check(await supabase.from('designs').select(DESIGN_COLUMNS).eq('active', true).order('name'))
  return rows as Design[]
}

/** Every design, active and retired. */
export async function loadDesigns(): Promise<Design[]> {
  const rows = check(await supabase.from('designs').select(DESIGN_COLUMNS).order('name'))
  return rows as Design[]
}

export async function loadDesign(designId: string): Promise<Design | null> {
  const { data, error } = await supabase.from('designs').select(DESIGN_COLUMNS).eq('id', designId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Design | null) ?? null
}

export interface DesignFields {
  name: string
  dimensions: string | null
  colors_finishes: string | null
  instructions: string | null
  has_dabber: boolean
  is_fumed: boolean
  active: boolean
}

function designSaveError(error: { code?: string; message: string }): Error {
  if (error.code === '23505') return new Error('A design with this name already exists. Choose a different name.')
  return new Error(friendlyDbMessage(error.message))
}

export async function createDesign(fields: DesignFields): Promise<string> {
  const { data, error } = await supabase.from('designs').insert(fields).select('id').single()
  if (error) throw designSaveError(error)
  return (data as { id: string }).id
}

export async function updateDesign(designId: string, fields: DesignFields): Promise<void> {
  const { error, count } = await supabase.from('designs').update(fields, { count: 'exact' }).eq('id', designId)
  if (error) throw designSaveError(error)
  if (count === 0) throw new Error('This design could not be changed. Refresh the page and try again.')
}

// --- Design prices (manager-only, dated, new rows only) ---------------------

export interface DesignPrice {
  id: string
  design_id: string
  price_per_bottle: number
  effective_from: string
  created_by: string | null
  created_at: string
}

/** One design's prices, or all of them: latest start date first, and newest first within a date. */
export async function loadDesignPrices(designId?: string): Promise<DesignPrice[]> {
  const query = supabase.from('design_prices').select('id, design_id, price_per_bottle, effective_from, created_by, created_at')
  const rows = check(
    await (designId ? query.eq('design_id', designId) : query)
      .order('effective_from', { ascending: false })
      .order('created_at', { ascending: false }),
  )
  return rows as DesignPrice[]
}

/** The dated price or rate in force on `today`, from a newest-first list.  Null means missing, never zero. */
export function inForceOn<T extends { effective_from: string }>(rows: T[], today: string): T | null {
  return rows.find((r) => r.effective_from <= today) ?? null
}

export async function addDesignPrice(designId: string, pricePerBottle: number, effectiveFrom: string): Promise<void> {
  const { error } = await supabase
    .from('design_prices')
    .insert({ design_id: designId, price_per_bottle: pricePerBottle, effective_from: effectiveFrom })
  if (error) throw new Error(friendlyDbMessage(error.message))
}

// --- Design photos ----------------------------------------------------------

/**
 * HEIC is left out on purpose even though the bucket accepts it: Chrome cannot
 * display it, so a photo uploaded that way would be broken on Android.  An
 * iPhone sends its photos as JPEG when asked for these types.
 */
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const PHOTO_MAX_BYTES = 10 * 1024 * 1024

export const PHOTO_ACCEPT = PHOTO_TYPES.join(',')

/** Why this file cannot be used, or null if it can. */
export function photoProblem(file: File): string | null {
  if (!PHOTO_TYPES.includes(file.type)) return 'Choose a JPEG, PNG or WebP photo. HEIC photos do not display on every phone.'
  if (file.size > PHOTO_MAX_BYTES) return 'That photo is larger than 10 MB. Choose a smaller one.'
  return null
}

async function uploadPhoto(designId: string, file: File): Promise<string> {
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-60) || 'photo'
  const path = `${designId}/${Date.now()}-${safeName}`
  const { error } = await supabase.storage.from('design-photos').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(`The photo could not be uploaded: ${error.message}`)
  return path
}

/** A file left behind does no harm, so a failed clean-up is not reported. */
async function discardPhoto(path: string | null): Promise<void> {
  if (path) await supabase.storage.from('design-photos').remove([path])
}

async function saveImagePath(designId: string, path: string | null): Promise<void> {
  const { error, count } = await supabase.from('designs').update({ product_image_path: path }, { count: 'exact' }).eq('id', designId)
  if (error) throw new Error(friendlyDbMessage(error.message))
  if (count === 0) throw new Error('This design could not be changed. Refresh the page and try again.')
}

/** The new image is in place before the old file goes, so the design is never left without one. */
export async function setProductImage(design: Design, file: File): Promise<void> {
  const path = await uploadPhoto(design.id, file)
  try {
    await saveImagePath(design.id, path)
  } catch (e) {
    await discardPhoto(path)
    throw e
  }
  await discardPhoto(design.product_image_path)
}

export async function removeProductImage(design: Design): Promise<void> {
  await saveImagePath(design.id, null)
  await discardPhoto(design.product_image_path)
}

export async function addReferencePhoto(designId: string, file: File, caption: string | null, sortOrder: number): Promise<void> {
  const path = await uploadPhoto(designId, file)
  const { error } = await supabase.from('design_photos').insert({ design_id: designId, storage_path: path, caption, sort_order: sortOrder })
  if (error) {
    await discardPhoto(path)
    throw new Error(friendlyDbMessage(error.message))
  }
}

export async function removeReferencePhoto(photo: DesignPhoto): Promise<void> {
  const { error } = await supabase.from('design_photos').delete().eq('id', photo.id)
  if (error) throw new Error(friendlyDbMessage(error.message))
  await discardPhoto(photo.storage_path)
}

// --- People -----------------------------------------------------------------

export interface Account {
  id: string
  full_name: string
  email: string
  alternate_emails: string[]
  role: Role
  active: boolean
}

export async function loadAccounts(): Promise<Account[]> {
  const rows = check(await supabase.from('profiles').select('id, full_name, email, alternate_emails, role, active').order('full_name'))
  return rows as Account[]
}

export async function updateAccount(id: string, changes: { full_name: string; role: Role; alternate_emails: string[] }): Promise<void> {
  const { error, count } = await supabase.from('profiles').update(changes, { count: 'exact' }).eq('id', id)
  if (error) throw new Error(friendlyDbMessage(error.message))
  if (count === 0) throw new Error('This account could not be changed. Refresh the page and try again.')
}

/** The signed-in manager's own choice of the screen the app opens on. */
export async function saveLandingScreen(id: string, screen: string): Promise<void> {
  const { error, count } = await supabase.from('profiles').update({ home_screen: screen }, { count: 'exact' }).eq('id', id)
  if (error) throw new Error(friendlyDbMessage(error.message))
  if (count === 0) throw new Error('This setting could not be saved. Refresh the page and try again.')
}

/** Deactivating keeps everything; accounts are never deleted. */
export async function setAccountActive(id: string, active: boolean): Promise<void> {
  const { error, count } = await supabase.from('profiles').update({ active }, { count: 'exact' }).eq('id', id)
  if (error) throw new Error(friendlyDbMessage(error.message))
  if (count === 0) throw new Error('This account could not be changed. Refresh the page and try again.')
}

export interface PayRate {
  id: string
  profile_id: string
  hourly_rate: number
  effective_from: string
  created_by: string | null
  created_at: string
}

/** One person's rates, or everyone's: latest start date first, and newest first within a date. */
export async function loadPayRates(profileId?: string): Promise<PayRate[]> {
  const query = supabase.from('pay_rates').select('id, profile_id, hourly_rate, effective_from, created_by, created_at')
  const rows = check(
    await (profileId ? query.eq('profile_id', profileId) : query)
      .order('effective_from', { ascending: false })
      .order('created_at', { ascending: false }),
  )
  return rows as PayRate[]
}

export async function addPayRate(profileId: string, hourlyRate: number, effectiveFrom: string): Promise<void> {
  const { error } = await supabase.from('pay_rates').insert({ profile_id: profileId, hourly_rate: hourlyRate, effective_from: effectiveFrom })
  if (error) throw new Error(friendlyDbMessage(error.message))
}

/**
 * Logins can only be made with an admin key, which never reaches this app, so
 * these go through the manage-account function on Supabase's servers.
 */
async function callAccountFunction(body: object): Promise<{ id: string }> {
  const { data, error } = await supabase.functions.invoke('manage-account', { body })
  if (error) {
    const response = (error as { context?: Response }).context
    const reply = (await response?.json().catch(() => null)) as { error?: string } | null | undefined
    throw new Error(reply?.error ?? 'Could not reach the server. Check your connection and try again.')
  }
  return data as { id: string }
}

export interface NewAccount {
  email: string
  password: string
  full_name: string
  role: Role
  alternate_emails: string[]
}

export async function createAccount(account: NewAccount): Promise<string> {
  const { id } = await callAccountFunction({ action: 'create', ...account })
  return id
}

export async function setAccountPassword(id: string, password: string): Promise<void> {
  await callAccountFunction({ action: 'set-password', id, password })
}

// --- Purchases and stock ----------------------------------------------------

export interface OrderLink {
  id: string
  name: string
  status: OrderStatus
}

export interface ManagedPurchase extends Purchase {
  decided_by: string | null
  order: OrderLink | null
}

const MANAGED_PURCHASE_COLUMNS =
  'id, artist_id, order_id, for_stock, description, amount, receipt_path, status, decided_by, decided_at, decision_reason, created_at, ' +
  'order:orders(id, name, status)'

/** What still needs a manager: purchases waiting for a decision, and approved stock.  Oldest first. */
export async function loadOpenPurchases(): Promise<ManagedPurchase[]> {
  const rows = check(
    await supabase
      .from('purchases')
      .select(MANAGED_PURCHASE_COLUMNS)
      .or('status.eq.pending,and(status.eq.approved,for_stock.is.true)')
      .order('created_at', { ascending: true }),
  )
  return rows as unknown as ManagedPurchase[]
}

/** The most recent decisions, newest first. */
export async function loadRecentDecisions(limit = 50): Promise<ManagedPurchase[]> {
  const rows = check(
    await supabase
      .from('purchases')
      .select(MANAGED_PURCHASE_COLUMNS)
      .neq('status', 'pending')
      .order('decided_at', { ascending: false, nullsFirst: false })
      .limit(limit),
  )
  return rows as unknown as ManagedPurchase[]
}

/** Only a purchase that is still pending changes, so two managers cannot both decide one. */
export async function decidePurchase(purchaseId: string, status: 'approved' | 'rejected', reason: string | null): Promise<void> {
  const { error, count } = await supabase
    .from('purchases')
    .update({ status, decision_reason: reason }, { count: 'exact' })
    .eq('id', purchaseId)
    .eq('status', 'pending')
  if (error) throw new Error(friendlyDbMessage(error.message))
  if (count === 0) throw new Error('Another manager has already decided this purchase. Refresh the page to see it.')
  window.dispatchEvent(new Event(PURCHASES_CHANGED))
}

export interface StockAllocation {
  id: string
  purchase_id: string
  order_id: string
  amount: number
  note: string | null
  order: OrderLink | null
}

export async function loadStockAllocations(): Promise<StockAllocation[]> {
  const rows = check(
    await supabase
      .from('stock_allocations')
      .select('id, purchase_id, order_id, amount, note, order:orders(id, name, status)')
      .order('created_at', { ascending: true }),
  )
  return rows as unknown as StockAllocation[]
}

export async function addStockAllocation(purchaseId: string, orderId: string, amount: number, note: string | null): Promise<void> {
  const { error } = await supabase.from('stock_allocations').insert({ purchase_id: purchaseId, order_id: orderId, amount, note })
  if (error) throw new Error(friendlyDbMessage(error.message))
}

export async function removeStockAllocation(allocationId: string): Promise<void> {
  const { error, count } = await supabase.from('stock_allocations').delete({ count: 'exact' }).eq('id', allocationId)
  if (error) throw new Error(friendlyDbMessage(error.message))
  if (count === 0) throw new Error('This allocation has already been removed. Refresh the page to see it.')
}

// --- Order cost by contributor (manager-only, rates by work date) ----------

export interface ContributorCost {
  artist_id: string
  entry_count: number
  minutes: number
  /** Null when the person had no pay rate on one of their work dates: missing, never zero. */
  labor_cost: number | null
  rated: boolean
}

export async function loadOrderCostByContributor(orderId: string): Promise<ContributorCost[]> {
  return check(await supabase.rpc('order_cost_by_contributor', { p_order_id: orderId })) as ContributorCost[]
}
