/**
 * The manager CSV exports: orders, entries, designs and purchases (brief:
 * Operations, "Export").  Each builds its file from what the signed-in account
 * can read; row-level security means an artist login would get no financial
 * columns filled in even if it reached this code, and the screen itself is in
 * the manager portal.
 */
import { supabase } from '../lib/supabase.ts'
import { check, DESIGN_COLUMNS, loadPeople, ORDER_COLUMNS } from '../lib/queries.ts'
import { toCsv, type Cell } from '../lib/csv.ts'
import { todayChicago } from '../lib/dates.ts'
import type { Design, Order, Person } from '../lib/types.ts'
import { inForceOn, loadDesignPrices, loadOrderCost, type OrderFinancials } from './queries.ts'

export interface ExportFile {
  fileName: string
  text: string
  rowCount: number
}

const who = (people: Map<string, Person>, id: string | null | undefined): string => (id ? (people.get(id)?.full_name ?? id) : '')

export async function exportOrders(): Promise<ExportFile> {
  const [rows, people] = await Promise.all([
    check(await supabase.from('orders').select(`${ORDER_COLUMNS}, design:designs(name)`).order('created_at')) as unknown as (Order & { design: { name: string } | null })[],
    loadPeople(),
  ])
  const financials = check(
    await supabase.from('order_financials').select('order_id, bottles_delivered, dabbers_delivered, selling_price, materials_total, materials_note, closed_by, closed_at'),
  ) as OrderFinancials[]
  const finById = new Map(financials.map((f) => [f.order_id, f]))
  // Labor and recorded cost come from the database's cost function, one call per closed order.
  const costs = new Map<string, Awaited<ReturnType<typeof loadOrderCost>>>()
  for (const o of rows) if (o.status === 'closed') costs.set(o.id, await loadOrderCost(o.id))

  const header = [
    'Order', 'Design', 'Status', 'Bottles ordered', 'Dabbers ordered', 'Due date', 'Primary artist', 'Created',
    'Finished by', 'Finished at', 'Packing note', 'Box L x W x H (in)', 'Package weight (lb)',
    'Bottles delivered', 'Dabbers delivered', 'Selling price', 'Materials (manager total)', 'Materials note',
    'Materials (incl. purchases)', 'Labor cost', 'Recorded cost', 'Amount remaining', 'Closed by', 'Closed at', 'Order id',
  ]
  const body: Cell[][] = rows.map((o) => {
    const f = finById.get(o.id)
    const c = costs.get(o.id)
    const box = o.box_length || o.box_width || o.box_height ? `${o.box_length ?? '?'} x ${o.box_width ?? '?'} x ${o.box_height ?? '?'}` : ''
    return [
      o.name, o.design?.name ?? '', o.status, o.bottles_ordered, o.dabbers_ordered, o.due_date, who(people, o.primary_artist_id), o.created_at,
      who(people, o.finished_by), o.finished_at, o.packing_note, box, o.box_weight,
      f?.bottles_delivered, f?.dabbers_delivered, f?.selling_price, f?.materials_total, f?.materials_note,
      c?.materials_cost, c?.labor_cost, c?.recorded_cost, c?.amount_remaining, who(people, f?.closed_by), f?.closed_at, o.id,
    ]
  })
  return { fileName: `ignite-orders-${todayChicago()}.csv`, text: toCsv(header, body), rowCount: body.length }
}

export async function exportEntries(): Promise<ExportFile> {
  const [rows, people] = await Promise.all([
    check(
      await supabase
        .from('entries')
        .select(
          'id, work_date, artist_id, order_id, bottles, dabbers, points, color_tube_preps, blanks, fuming, note, created_at, edited_by, edited_at, ' +
            'entry_time(minutes), order:orders(name, design:designs(name))',
        )
        .order('work_date')
        .order('created_at'),
    ) as unknown as {
      id: string; work_date: string; artist_id: string; order_id: string
      bottles: number | null; dabbers: number | null; points: number | null; color_tube_preps: number | null; blanks: number | null; fuming: number | null
      note: string | null; created_at: string; edited_by: string | null; edited_at: string | null
      entry_time: { minutes: number } | { minutes: number }[] | null
      order: { name: string; design: { name: string } | null } | null
    }[],
    loadPeople(),
  ])
  const header = [
    'Work date', 'Artist', 'Order', 'Design', 'Bottles', 'Dabbers', 'Points', 'Color tube preps', 'Blanks', 'Fumed', 'Minutes', 'Note',
    'Created', 'Edited by', 'Edited at', 'Entry id', 'Order id',
  ]
  const body: Cell[][] = rows.map((e) => {
    const t = Array.isArray(e.entry_time) ? e.entry_time[0] : e.entry_time
    return [
      e.work_date, who(people, e.artist_id), e.order?.name ?? '', e.order?.design?.name ?? '',
      e.bottles, e.dabbers, e.points, e.color_tube_preps, e.blanks, e.fuming, t?.minutes ?? null, e.note,
      e.created_at, who(people, e.edited_by), e.edited_at, e.id, e.order_id,
    ]
  })
  return { fileName: `ignite-entries-${todayChicago()}.csv`, text: toCsv(header, body), rowCount: body.length }
}

export async function exportDesigns(): Promise<ExportFile> {
  const [designs, prices] = await Promise.all([check(await supabase.from('designs').select(DESIGN_COLUMNS).order('name')) as Design[], loadDesignPrices()])
  const today = todayChicago()
  const header = ['Design', 'Active', 'Has dabber', 'Fumed', 'Dimensions', 'Colors and finishes', 'Instructions', 'Current price per bottle', 'Price since', 'Has product image', 'Design id']
  const body: Cell[][] = designs.map((d) => {
    const price = inForceOn(
      prices.filter((p) => p.design_id === d.id),
      today,
    )
    return [d.name, d.active, d.has_dabber, d.is_fumed, d.dimensions, d.colors_finishes, d.instructions, price?.price_per_bottle, price?.effective_from, d.product_image_path !== null, d.id]
  })
  return { fileName: `ignite-designs-${todayChicago()}.csv`, text: toCsv(header, body), rowCount: body.length }
}

export async function exportPurchases(): Promise<ExportFile> {
  const [rows, people] = await Promise.all([
    check(
      await supabase
        .from('purchases')
        .select('id, created_at, artist_id, order_id, for_stock, description, amount, receipt_path, status, decided_by, decided_at, decision_reason, order:orders(name)')
        .order('created_at'),
    ) as unknown as {
      id: string; created_at: string; artist_id: string; order_id: string | null; for_stock: boolean; description: string; amount: number
      receipt_path: string | null; status: string; decided_by: string | null; decided_at: string | null; decision_reason: string | null
      order: { name: string } | null
    }[],
    loadPeople(),
  ])
  const header = ['Submitted', 'Submitted by', 'For', 'Description', 'Amount', 'Status', 'Decided by', 'Decided at', 'Reason', 'Has receipt', 'Purchase id', 'Order id']
  const body: Cell[][] = rows.map((p) => [
    p.created_at, who(people, p.artist_id), p.for_stock ? 'Studio stock' : (p.order?.name ?? ''), p.description, p.amount, p.status,
    who(people, p.decided_by), p.decided_at, p.decision_reason, p.receipt_path !== null, p.id, p.order_id,
  ])
  return { fileName: `ignite-purchases-${todayChicago()}.csv`, text: toCsv(header, body), rowCount: body.length }
}

export const EXPORTS = [
  { key: 'orders', name: 'Orders', what: 'Every order with its design, quantities, dates, who finished and closed it, and for closed orders the delivered quantities, price, materials, labor, recorded cost and amount remaining.', run: exportOrders },
  { key: 'entries', name: 'Entries', what: 'Every daily entry: date, artist, order, design, each count on its own, minutes, note, and who edited it.', run: exportEntries },
  { key: 'designs', name: 'Designs', what: 'Every design with its specifications, whether it has a dabber or is fumed, and its current price per bottle.', run: exportDesigns },
  { key: 'purchases', name: 'Purchases', what: 'Every materials purchase submission with amount, order or stock, status, and the decision.', run: exportPurchases },
] as const
