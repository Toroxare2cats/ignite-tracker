import type { Design } from '../lib/types.ts'
import { blankToNull } from './format.ts'
import type { DesignFields } from './queries.ts'

/** What the design form holds while someone is typing. */
export interface DesignValues {
  name: string
  dimensions: string
  colors: string
  instructions: string
  hasDabber: boolean
  isFumed: boolean
  active: boolean
}

export const BLANK_DESIGN: DesignValues = {
  name: '',
  dimensions: '',
  colors: '',
  instructions: '',
  hasDabber: false,
  isFumed: false,
  active: true,
}

export function designValues(design: Design): DesignValues {
  return {
    name: design.name,
    dimensions: design.dimensions ?? '',
    colors: design.colors_finishes ?? '',
    instructions: design.instructions ?? '',
    hasDabber: design.has_dabber,
    isFumed: design.is_fumed,
    active: design.active,
  }
}

export function designFields(values: DesignValues): DesignFields {
  return {
    name: values.name.trim(),
    dimensions: blankToNull(values.dimensions),
    colors_finishes: blankToNull(values.colors),
    instructions: blankToNull(values.instructions),
    has_dabber: values.hasDabber,
    is_fumed: values.isFumed,
    active: values.active,
  }
}
