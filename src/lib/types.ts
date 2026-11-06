export type OrderStatus = 'open' | 'finished' | 'closed'
export type PurchaseStatus = 'pending' | 'approved' | 'rejected'

export interface Person {
  id: string
  full_name: string
  role: 'artist' | 'manager'
  active: boolean
}

export interface Design {
  id: string
  name: string
  product_image_path: string | null
  dimensions: string | null
  colors_finishes: string | null
  instructions: string | null
  has_dabber: boolean
  is_fumed: boolean
  active: boolean
}

export interface DesignPhoto {
  id: string
  design_id: string
  storage_path: string
  caption: string | null
  sort_order: number
}

export interface Order {
  id: string
  name: string
  design_id: string
  bottles_ordered: number
  dabbers_ordered: number
  due_date: string | null
  primary_artist_id: string | null
  status: OrderStatus
  spec_dimensions: string | null
  spec_colors_finishes: string | null
  spec_instructions: string | null
  finished_by: string | null
  finished_at: string | null
  created_at: string
}

/** An order with its design embedded (orders.design_id -> designs). */
export interface OrderWithDesign extends Order {
  design: Design
}

/** The counting fields of an entry, all optional. */
export interface Counts {
  bottles: number | null
  dabbers: number | null
  points: number | null
  color_tube_preps: number | null
  blanks: number | null
  fuming: number | null
}

export interface Entry extends Counts {
  id: string
  order_id: string
  artist_id: string
  work_date: string
  note: string | null
  created_at: string
  edited_by: string | null
  edited_at: string | null
}

/** An entry plus the minutes the signed-in person is allowed to see (null when hidden). */
export interface EntryWithTime extends Entry {
  minutes: number | null
}

export interface Purchase {
  id: string
  artist_id: string
  order_id: string | null
  for_stock: boolean
  description: string
  amount: number
  receipt_path: string | null
  status: PurchaseStatus
  decided_at: string | null
  decision_reason: string | null
  created_at: string
}

export const COUNT_FIELDS: { key: keyof Counts; label: string; short: string }[] = [
  { key: 'bottles', label: 'Bottles', short: 'bottles' },
  { key: 'dabbers', label: 'Dabbers', short: 'dabbers' },
  { key: 'points', label: 'Points', short: 'points' },
  { key: 'color_tube_preps', label: 'Color tube preps', short: 'color tube preps' },
  { key: 'blanks', label: 'Blanks', short: 'blanks' },
  { key: 'fuming', label: 'Fumed', short: 'fumed' },
]

/**
 * A readable list of an entry's counts, each activity kept separate
 * (rule 3: activity counts are never summed together).
 */
export function describeCounts(counts: Counts): string[] {
  const parts: string[] = []
  for (const f of COUNT_FIELDS) {
    const value = counts[f.key]
    if (value !== null && value !== undefined && value > 0) {
      parts.push(`${value} ${f.key === 'fuming' ? 'fumed' : f.short}`)
    }
  }
  return parts
}
