/**
 * The fixed catalogue: materials, suppliers, the bill of materials recipe,
 * plants, lines and regions. These are hand-written so the metallurgy is sensible
 * (316L uses molybdenum, 430 uses no nickel, 201 uses more manganese).
 */
import type {
  Grade, Form, Finish, RegionName, Region, Warehouse, Plant,
  ProductionLine, MaterialCategory,
} from './types'

export const GRADES: Grade[] = ['304', '316L', '430', '201']
export const FORMS: Form[] = ['Cold-rolled coil', 'Hot-rolled coil', 'Sheet']
export const THICKNESS = [0.5, 1.0, 2.0, 3.0]
export const FINISHES: Finish[] = ['2B', 'BA', 'No.1', 'No.4', 'HL']
export const REGION_NAMES: RegionName[] = ['North', 'South', 'East', 'West']

export const GRADE_NOTE: Record<Grade, string> = {
  '304': 'General purpose austenitic. The workhorse grade — widest customer base.',
  '316L': 'Molybdenum-bearing austenitic. Used where corrosion resistance matters: pharma, food processing, chemicals.',
  '430': 'Ferritic, nickel-free. Cost-sensitive appliance and trim applications.',
  '201': 'Manganese-substituted austenitic. Lower nickel, price-driven demand.',
}

export const REGIONS: Region[] = [
  { id: 'North', name: 'North', hubCity: 'Northern hub', warehouses: ['WH-N1'], share: 0.26,
    industries: ['Automotive', 'Appliances', 'Construction'] },
  { id: 'South', name: 'South', hubCity: 'Southern hub', warehouses: ['WH-S1', 'WH-S2'], share: 0.30,
    industries: ['Pharmaceuticals', 'Food processing', 'Automotive'] },
  { id: 'East', name: 'East', hubCity: 'Eastern hub', warehouses: ['WH-E1'], share: 0.18,
    industries: ['Railways', 'Construction', 'Heavy engineering'] },
  { id: 'West', name: 'West', hubCity: 'Western hub', warehouses: ['WH-W1', 'WH-W2'], share: 0.26,
    industries: ['Chemicals', 'Pharmaceuticals', 'Appliances'] },
]

export const WAREHOUSES: Warehouse[] = [
  { id: 'WH-N1', name: 'North Distribution Warehouse', region: 'North', type: 'Distribution warehouse', capacityT: 4200 },
  { id: 'WH-S1', name: 'South Plant Warehouse',        region: 'South', type: 'Plant warehouse',        capacityT: 3000 },
  { id: 'WH-S2', name: 'South Distribution Warehouse', region: 'South', type: 'Distribution warehouse', capacityT: 3300 },
  { id: 'WH-E1', name: 'East Distribution Warehouse',  region: 'East',  type: 'Distribution warehouse', capacityT: 6500 },
  { id: 'WH-W1', name: 'West Plant Warehouse',         region: 'West',  type: 'Plant warehouse',        capacityT: 7500 },
  { id: 'WH-W2', name: 'West Distribution Warehouse',  region: 'West',  type: 'Distribution warehouse', capacityT: 3800 },
]

export const PLANTS: Plant[] = [
  { id: 'PL-1', name: 'Plant 1 — West', region: 'West', lines: ['LN-1', 'LN-2', 'LN-3'], commissioned: 2009 },
  { id: 'PL-2', name: 'Plant 2 — South', region: 'South', lines: ['LN-4', 'LN-5'], commissioned: 2016 },
]

/**
 * The route each form takes through the plant, in order.
 *
 * Steel is made in sequence, not in parallel: every tonne is melted, then hot
 * rolled, and cold-rolled products go on through the cold mill, the anneal and
 * finishing. The plan used to be *divided* between the lines that could handle
 * a form, which modelled a tonne as being made by one line out of several —
 * so the loads summed to the plant's output instead of several times it, and
 * every line's utilisation was wrong.
 */
export const ROUTING: Record<Form, ProductionLine['process'][]> = {
  'Hot-rolled coil': ['Melting & casting', 'Hot rolling'],
  'Cold-rolled coil': ['Melting & casting', 'Hot rolling', 'Cold rolling', 'Annealing & pickling', 'Finishing & slitting'],
  'Sheet': ['Melting & casting', 'Hot rolling', 'Cold rolling', 'Annealing & pickling', 'Finishing & slitting'],
}

/**
 * Line capacities, in tonnes of steel through that line per week.
 *
 * These have to be consistent with what the plant actually makes. They were
 * set at 700-1,700 t against an output of 4,300-4,900 t a week, which is not
 * possible when every tonne passes through melting — the shortfall was being
 * hidden behind a "one tonne of melting supports 2.85 tonnes of product"
 * multiplier that has no physical meaning.
 *
 * Sized so the upstream lines carry the whole plant and the finishing end
 * carries the ~70% that is cold-rolled or sheet. Annealing is deliberately the
 * tightest: it is the constraint, which is what the Lines panel now shows.
 *
 * The headroom is deliberately uneven. Melting and annealing run close enough
 * to the plan that a shutdown on either costs output; hot rolling, the cold
 * mill and finishing carry enough slack to absorb one. That difference is the
 * whole point of flagging which shutdowns bite.
 */
export const LINES: ProductionLine[] = [
  { id: 'LN-1', name: 'Line 1 — Melting & Casting', plantId: 'PL-1', process: 'Melting & casting',
    weeklyCapacityT: 5200, shifts: 3, maintenanceWeeks: [110, 122], forms: ['Hot-rolled coil', 'Cold-rolled coil', 'Sheet'] },
  { id: 'LN-2', name: 'Line 2 — Hot Rolling', plantId: 'PL-1', process: 'Hot rolling',
    weeklyCapacityT: 6800, shifts: 3, maintenanceWeeks: [108, 120], forms: ['Hot-rolled coil', 'Cold-rolled coil', 'Sheet'] },
  { id: 'LN-3', name: 'Line 3 — Cold Rolling', plantId: 'PL-1', process: 'Cold rolling',
    weeklyCapacityT: 5000, shifts: 3, maintenanceWeeks: [113], forms: ['Cold-rolled coil', 'Sheet'] },
  { id: 'LN-4', name: 'Line 4 — Annealing & Pickling', plantId: 'PL-2', process: 'Annealing & pickling',
    weeklyCapacityT: 3500, shifts: 2, maintenanceWeeks: [107, 118], forms: ['Cold-rolled coil', 'Sheet'] },
  { id: 'LN-5', name: 'Line 5 — Finishing & Slitting', plantId: 'PL-2', process: 'Finishing & slitting',
    weeklyCapacityT: 5200, shifts: 2, maintenanceWeeks: [115], forms: ['Cold-rolled coil', 'Sheet'] },
]

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export interface MatSpec {
  code: string; name: string; category: MaterialCategory
  unit: 'kg' | 't' | 'L' | 'nos' | 'm³'
  cost: number           // ₹ per unit
  critical: boolean
  shelfLifeDays: number | null
  storage: string
  moq: number
  lotRule: 'Lot-for-lot' | 'Fixed lot' | 'Min order qty'
  lotSize: number
  leadTimeDays: number
  leadTimeSdDays: number
  primary: string
  backups: string[]
  substitutes: string[]
  priceTrendPct: number
  /** Days of stock we want to START the demo with — drives the story. */
  targetCoverDays: number
  notes: string
}

export const MATERIAL_SPECS: MatSpec[] = [
  // --- Alloys and base metals -------------------------------------------------
  { code: 'RM-101', name: 'Stainless steel scrap', category: 'Base metal', unit: 't', cost: 142000, critical: true,
    shelfLifeDays: null, storage: 'Scrap yard A', moq: 50, lotRule: 'Min order qty', lotSize: 25, leadTimeDays: 9, leadTimeSdDays: 2.5,
    primary: 'S-04', backups: ['S-05'], substitutes: [], priceTrendPct: 3.2, targetCoverDays: 12,
    notes: 'Charge base for every heat. Price tracks the nickel and chrome indices.' },
  { code: 'RM-102', name: 'Ferrochrome (high carbon)', category: 'Alloy', unit: 't', cost: 118000, critical: true,
    shelfLifeDays: null, storage: 'Alloy bay 1', moq: 20, lotRule: 'Min order qty', lotSize: 10, leadTimeDays: 21, leadTimeSdDays: 4,
    primary: 'S-01', backups: ['S-03'], substitutes: ['RM-103'], priceTrendPct: -2.4, targetCoverDays: 86,
    notes: 'Chrome source for 304, 430 and 201. Not used in 316L, which needs the low-carbon grade.' },
  { code: 'RM-103', name: 'Ferrochrome (low carbon)', category: 'Alloy', unit: 't', cost: 164000, critical: true,
    shelfLifeDays: null, storage: 'Alloy bay 1', moq: 10, lotRule: 'Min order qty', lotSize: 5, leadTimeDays: 24, leadTimeSdDays: 5,
    primary: 'S-01', backups: ['S-03'], substitutes: [], priceTrendPct: 1.8, targetCoverDays: 24,
    notes: 'Required for 316L, where carbon must stay low.' },
  { code: 'RM-104', name: 'Nickel cathode', category: 'Base metal', unit: 't', cost: 1680000, critical: true,
    shelfLifeDays: null, storage: 'Secure alloy store', moq: 5, lotRule: 'Min order qty', lotSize: 1, leadTimeDays: 35, leadTimeSdDays: 7,
    primary: 'S-02', backups: ['S-03'], substitutes: [], priceTrendPct: 6.4, targetCoverDays: 44,
    notes: 'Highest-value input. Imported; price moves with the global nickel index.' },
  { code: 'RM-105', name: 'Ferromolybdenum', category: 'Alloy', unit: 't', cost: 2450000, critical: true,
    shelfLifeDays: null, storage: 'Secure alloy store', moq: 2, lotRule: 'Min order qty', lotSize: 1, leadTimeDays: 42, leadTimeSdDays: 6,
    primary: 'S-02', backups: ['S-03'], substitutes: [], priceTrendPct: 8.1, targetCoverDays: 26,
    notes: 'Used only in 316L. Six-week import lead time makes it the single most time-sensitive material on site.' },
  { code: 'RM-106', name: 'Ferromanganese', category: 'Alloy', unit: 't', cost: 96000, critical: true,
    shelfLifeDays: null, storage: 'Alloy bay 2', moq: 20, lotRule: 'Min order qty', lotSize: 10, leadTimeDays: 16, leadTimeSdDays: 3,
    primary: 'S-01', backups: ['S-03'], substitutes: [], priceTrendPct: 1.1, targetCoverDays: 24,
    notes: 'Heavy use in 201, where manganese substitutes for part of the nickel.' },
  { code: 'RM-107', name: 'Ferrosilicon', category: 'Alloy', unit: 't', cost: 102000, critical: false,
    shelfLifeDays: null, storage: 'Alloy bay 2', moq: 10, lotRule: 'Min order qty', lotSize: 5, leadTimeDays: 14, leadTimeSdDays: 3,
    primary: 'S-01', backups: ['S-03'], substitutes: [], priceTrendPct: 0.4, targetCoverDays: 37,
    notes: 'Deoxidiser used across all grades.' },
  { code: 'RM-108', name: 'Ferrotitanium', category: 'Alloy', unit: 't', cost: 385000, critical: false,
    shelfLifeDays: null, storage: 'Alloy bay 2', moq: 2, lotRule: 'Min order qty', lotSize: 1, leadTimeDays: 28, leadTimeSdDays: 5,
    primary: 'S-03', backups: ['S-01'], substitutes: [], priceTrendPct: 2.0, targetCoverDays: 40,
    notes: 'Stabiliser for 430. Usage falls when 430 demand falls.' },
  { code: 'RM-109', name: 'Ferroniobium', category: 'Alloy', unit: 't', cost: 1240000, critical: false,
    shelfLifeDays: null, storage: 'Secure alloy store', moq: 1, lotRule: 'Min order qty', lotSize: 1, leadTimeDays: 38, leadTimeSdDays: 6,
    primary: 'S-03', backups: ['S-02'], substitutes: ['RM-108'], priceTrendPct: 4.2, targetCoverDays: 22,
    notes: 'Alternative stabiliser; approved substitute for ferrotitanium at 0.8 : 1.' },
  { code: 'RM-110', name: 'Aluminium deoxidiser shot', category: 'Consumable', unit: 'kg', cost: 245, critical: false,
    shelfLifeDays: 540, storage: 'Alloy bay 2', moq: 500, lotRule: 'Fixed lot', lotSize: 500, leadTimeDays: 12, leadTimeSdDays: 2,
    primary: 'S-01', backups: ['S-11'], substitutes: [], priceTrendPct: 1.5, targetCoverDays: 41, notes: 'Ladle deoxidation.' },

  // --- Flux -------------------------------------------------------------------
  { code: 'RM-111', name: 'Burnt lime', category: 'Flux', unit: 't', cost: 9800, critical: false,
    shelfLifeDays: 120, storage: 'Flux silo 1', moq: 40, lotRule: 'Min order qty', lotSize: 20, leadTimeDays: 7, leadTimeSdDays: 1.5,
    primary: 'S-07', backups: ['S-10'], substitutes: [], priceTrendPct: 0.8, targetCoverDays: 19,
    notes: 'Absorbs moisture — short shelf life, so we deliberately hold less.' },
  { code: 'RM-112', name: 'Dolomitic lime', category: 'Flux', unit: 't', cost: 8600, critical: false,
    shelfLifeDays: 120, storage: 'Flux silo 2', moq: 40, lotRule: 'Min order qty', lotSize: 20, leadTimeDays: 7, leadTimeSdDays: 1.5,
    primary: 'S-07', backups: ['S-10'], substitutes: ['RM-111'], priceTrendPct: 0.6, targetCoverDays: 26, notes: 'Protects furnace lining.' },
  { code: 'RM-113', name: 'Fluorspar', category: 'Flux', unit: 't', cost: 32000, critical: false,
    shelfLifeDays: null, storage: 'Flux silo 3', moq: 10, lotRule: 'Min order qty', lotSize: 5, leadTimeDays: 18, leadTimeSdDays: 4,
    primary: 'S-07', backups: ['S-10'], substitutes: [], priceTrendPct: 2.2, targetCoverDays: 44, notes: 'Slag fluidiser.' },

  // --- Industrial gases -------------------------------------------------------
  { code: 'RM-114', name: 'Argon', category: 'Industrial gas', unit: 'm³', cost: 38, critical: true,
    shelfLifeDays: null, storage: 'Gas yard', moq: 4000, lotRule: 'Fixed lot', lotSize: 4000, leadTimeDays: 4, leadTimeSdDays: 1,
    primary: 'S-06', backups: [], substitutes: [], priceTrendPct: 1.2, targetCoverDays: 16,
    notes: 'AOD refining gas. Delivered by tanker — short lead time but no backup supplier on site.' },
  { code: 'RM-115', name: 'Nitrogen', category: 'Industrial gas', unit: 'm³', cost: 14, critical: false,
    shelfLifeDays: null, storage: 'Gas yard', moq: 6000, lotRule: 'Fixed lot', lotSize: 6000, leadTimeDays: 4, leadTimeSdDays: 1,
    primary: 'S-06', backups: [], substitutes: [], priceTrendPct: 0.5, targetCoverDays: 15, notes: 'Bright annealing atmosphere.' },
  { code: 'RM-116', name: 'Oxygen', category: 'Industrial gas', unit: 'm³', cost: 11, critical: false,
    shelfLifeDays: null, storage: 'Gas yard', moq: 10000, lotRule: 'Fixed lot', lotSize: 10000, leadTimeDays: 3, leadTimeSdDays: 1,
    primary: 'S-06', backups: [], substitutes: [], priceTrendPct: 0.3, targetCoverDays: 17, notes: 'Decarburisation.' },
  { code: 'RM-117', name: 'LPG', category: 'Industrial gas', unit: 'kg', cost: 68, critical: false,
    shelfLifeDays: null, storage: 'Gas yard', moq: 3000, lotRule: 'Fixed lot', lotSize: 3000, leadTimeDays: 5, leadTimeSdDays: 1.5,
    primary: 'S-06', backups: ['S-08'], substitutes: [], priceTrendPct: 2.8, targetCoverDays: 21, notes: 'Reheat furnace fuel.' },

  // --- Process chemicals ------------------------------------------------------
  { code: 'RM-118', name: 'Nitric acid', category: 'Process chemical', unit: 'L', cost: 42, critical: true,
    shelfLifeDays: 365, storage: 'Acid farm', moq: 8000, lotRule: 'Fixed lot', lotSize: 8000, leadTimeDays: 11, leadTimeSdDays: 2.5,
    primary: 'S-09', backups: ['S-08'], substitutes: [], priceTrendPct: 3.6, targetCoverDays: 12,
    notes: 'Pickling line. Hazardous storage limits how much we can hold.' },
  { code: 'RM-119', name: 'Hydrofluoric acid', category: 'Process chemical', unit: 'L', cost: 96, critical: true,
    shelfLifeDays: 365, storage: 'Acid farm (bunded)', moq: 4000, lotRule: 'Fixed lot', lotSize: 4000, leadTimeDays: 14, leadTimeSdDays: 3,
    primary: 'S-09', backups: [], substitutes: [], priceTrendPct: 4.1, targetCoverDays: 17,
    notes: 'Mixed-acid pickling. Single approved supplier — a known concentration risk.' },
  { code: 'RM-120', name: 'Sulphuric acid', category: 'Process chemical', unit: 'L', cost: 18, critical: false,
    shelfLifeDays: 540, storage: 'Acid farm', moq: 6000, lotRule: 'Fixed lot', lotSize: 6000, leadTimeDays: 9, leadTimeSdDays: 2,
    primary: 'S-09', backups: ['S-08'], substitutes: [], priceTrendPct: 1.0, targetCoverDays: 29, notes: 'Descaling.' },
  { code: 'RM-121', name: 'Pickling inhibitor', category: 'Process chemical', unit: 'L', cost: 320, critical: false,
    shelfLifeDays: 300, storage: 'Chemical store', moq: 400, lotRule: 'Fixed lot', lotSize: 400, leadTimeDays: 16, leadTimeSdDays: 3,
    primary: 'S-08', backups: ['S-09'], substitutes: [], priceTrendPct: 1.4, targetCoverDays: 38, notes: 'Protects base metal during pickling.' },
  { code: 'RM-122', name: 'Rolling oil', category: 'Process chemical', unit: 'L', cost: 185, critical: true,
    shelfLifeDays: 420, storage: 'Oil store', moq: 2000, lotRule: 'Fixed lot', lotSize: 2000, leadTimeDays: 13, leadTimeSdDays: 3,
    primary: 'S-08', backups: ['S-12'], substitutes: [], priceTrendPct: 2.6, targetCoverDays: 22, notes: 'Cold mill lubrication and cooling.' },
  { code: 'RM-123', name: 'Furnace fuel additive', category: 'Process chemical', unit: 'L', cost: 240, critical: false,
    shelfLifeDays: 300, storage: 'Chemical store', moq: 600, lotRule: 'Fixed lot', lotSize: 600, leadTimeDays: 15, leadTimeSdDays: 3,
    primary: 'S-08', backups: [], substitutes: [], priceTrendPct: 1.9, targetCoverDays: 47, notes: 'Combustion efficiency in annealing.' },
  { code: 'RM-124', name: 'Neutralising agent', category: 'Process chemical', unit: 'kg', cost: 26, critical: false,
    shelfLifeDays: 240, storage: 'Effluent plant', moq: 5000, lotRule: 'Fixed lot', lotSize: 5000, leadTimeDays: 8, leadTimeSdDays: 2,
    primary: 'S-07', backups: ['S-08'], substitutes: [], priceTrendPct: 0.7, targetCoverDays: 33, notes: 'Effluent treatment — statutory.' },

  // --- Consumables ------------------------------------------------------------
  { code: 'RM-125', name: 'Graphite electrode', category: 'Consumable', unit: 'nos', cost: 182000, critical: true,
    shelfLifeDays: null, storage: 'Electrode store', moq: 6, lotRule: 'Min order qty', lotSize: 3, leadTimeDays: 30, leadTimeSdDays: 6,
    primary: 'S-11', backups: ['S-10'], substitutes: [], priceTrendPct: 5.2, targetCoverDays: 18, notes: 'Electric arc furnace. Long lead, high value.' },
  { code: 'RM-126', name: 'Refractory brick (MgO-C)', category: 'Consumable', unit: 'nos', cost: 2850, critical: true,
    shelfLifeDays: null, storage: 'Refractory store', moq: 300, lotRule: 'Fixed lot', lotSize: 300, leadTimeDays: 22, leadTimeSdDays: 5,
    primary: 'S-10', backups: ['S-11'], substitutes: [], priceTrendPct: 2.1, targetCoverDays: 40, notes: 'Furnace and ladle lining.' },
  { code: 'RM-127', name: 'Tundish board', category: 'Consumable', unit: 'nos', cost: 4200, critical: false,
    shelfLifeDays: null, storage: 'Refractory store', moq: 80, lotRule: 'Fixed lot', lotSize: 80, leadTimeDays: 20, leadTimeSdDays: 4,
    primary: 'S-10', backups: [], substitutes: [], priceTrendPct: 1.6, targetCoverDays: 43, notes: 'Continuous casting consumable.' },
  { code: 'RM-128', name: 'Casting powder', category: 'Consumable', unit: 'kg', cost: 390, critical: false,
    shelfLifeDays: 365, storage: 'Caster store', moq: 1500, lotRule: 'Fixed lot', lotSize: 1500, leadTimeDays: 18, leadTimeSdDays: 4,
    primary: 'S-10', backups: ['S-11'], substitutes: [], priceTrendPct: 1.3, targetCoverDays: 36, notes: 'Mould lubrication during casting.' },
  { code: 'RM-129', name: 'Work roll (cold mill)', category: 'Spare part', unit: 'nos', cost: 1460000, critical: true,
    shelfLifeDays: null, storage: 'Roll shop', moq: 2, lotRule: 'Min order qty', lotSize: 1, leadTimeDays: 56, leadTimeSdDays: 10,
    primary: 'S-12', backups: [], substitutes: [], priceTrendPct: 3.4, targetCoverDays: 26, notes: 'Longest lead time on site at eight weeks.' },
  { code: 'RM-130', name: 'Backup roll', category: 'Spare part', unit: 'nos', cost: 3900000, critical: true,
    shelfLifeDays: null, storage: 'Roll shop', moq: 1, lotRule: 'Min order qty', lotSize: 1, leadTimeDays: 84, leadTimeSdDays: 14,
    primary: 'S-12', backups: [], substitutes: [], priceTrendPct: 2.9, targetCoverDays: 45, notes: 'Capital spare — ordered well ahead.' },
  { code: 'RM-131', name: 'Grinding wheel', category: 'Consumable', unit: 'nos', cost: 18500, critical: false,
    shelfLifeDays: null, storage: 'Roll shop', moq: 20, lotRule: 'Fixed lot', lotSize: 20, leadTimeDays: 17, leadTimeSdDays: 3,
    primary: 'S-12', backups: ['S-11'], substitutes: [], priceTrendPct: 1.1, targetCoverDays: 46, notes: 'Roll regrinding.' },
  { code: 'RM-132', name: 'Abrasive belt', category: 'Consumable', unit: 'nos', cost: 3400, critical: false,
    shelfLifeDays: null, storage: 'Finishing store', moq: 60, lotRule: 'Fixed lot', lotSize: 60, leadTimeDays: 15, leadTimeSdDays: 3,
    primary: 'S-12', backups: ['S-11'], substitutes: [], priceTrendPct: 1.7, targetCoverDays: 28, notes: 'Only used for the No.4 brushed finish.' },
  { code: 'RM-133', name: 'Polishing compound', category: 'Consumable', unit: 'kg', cost: 640, critical: false,
    shelfLifeDays: 400, storage: 'Finishing store', moq: 300, lotRule: 'Fixed lot', lotSize: 300, leadTimeDays: 14, leadTimeSdDays: 3,
    primary: 'S-08', backups: ['S-12'], substitutes: [], priceTrendPct: 1.2, targetCoverDays: 52, notes: 'Only used for the hairline (HL) finish.' },

  // --- Packaging --------------------------------------------------------------
  { code: 'RM-134', name: 'Steel strapping', category: 'Packaging', unit: 'kg', cost: 108, critical: false,
    shelfLifeDays: null, storage: 'Despatch store', moq: 4000, lotRule: 'Fixed lot', lotSize: 4000, leadTimeDays: 10, leadTimeSdDays: 2,
    primary: 'S-13', backups: ['S-14'], substitutes: [], priceTrendPct: 1.8, targetCoverDays: 27, notes: 'Coil banding.' },
  { code: 'RM-135', name: 'Wooden skid', category: 'Packaging', unit: 'nos', cost: 720, critical: false,
    shelfLifeDays: null, storage: 'Despatch yard', moq: 400, lotRule: 'Fixed lot', lotSize: 400, leadTimeDays: 8, leadTimeSdDays: 2,
    primary: 'S-14', backups: ['S-13'], substitutes: [], priceTrendPct: 2.4, targetCoverDays: 9,
    notes: 'Monsoon supply is unreliable — a repeat offender on the exception list.' },
  { code: 'RM-136', name: 'Interleaving paper', category: 'Packaging', unit: 'kg', cost: 86, critical: false,
    shelfLifeDays: 720, storage: 'Despatch store', moq: 2500, lotRule: 'Fixed lot', lotSize: 2500, leadTimeDays: 12, leadTimeSdDays: 2.5,
    primary: 'S-13', backups: ['S-14'], substitutes: [], priceTrendPct: 1.0, targetCoverDays: 31, notes: 'Protects polished surfaces in transit.' },
  { code: 'RM-137', name: 'Coil sleeve', category: 'Packaging', unit: 'nos', cost: 310, critical: false,
    shelfLifeDays: null, storage: 'Despatch store', moq: 600, lotRule: 'Fixed lot', lotSize: 600, leadTimeDays: 11, leadTimeSdDays: 2,
    primary: 'S-13', backups: ['S-14'], substitutes: [], priceTrendPct: 0.9, targetCoverDays: 34, notes: 'Inner diameter protection.' },
  { code: 'RM-138', name: 'VCI wrap film', category: 'Packaging', unit: 'kg', cost: 275, critical: false,
    shelfLifeDays: 540, storage: 'Despatch store', moq: 800, lotRule: 'Fixed lot', lotSize: 800, leadTimeDays: 13, leadTimeSdDays: 3,
    primary: 'S-13', backups: [], substitutes: [], priceTrendPct: 1.5, targetCoverDays: 25, notes: 'Corrosion-inhibiting wrap for export coils.' },

  // --- Spares -----------------------------------------------------------------
  { code: 'RM-139', name: 'Mill bearing assembly', category: 'Spare part', unit: 'nos', cost: 268000, critical: true,
    shelfLifeDays: null, storage: 'Spares store', moq: 2, lotRule: 'Min order qty', lotSize: 1, leadTimeDays: 45, leadTimeSdDays: 9,
    primary: 'S-15', backups: ['S-12'], substitutes: [], priceTrendPct: 2.2, targetCoverDays: 30, notes: 'Insurance spare for the cold mill.' },
  { code: 'RM-140', name: 'Hydraulic seal kit', category: 'Spare part', unit: 'nos', cost: 42000, critical: false,
    shelfLifeDays: 1095, storage: 'Spares store', moq: 6, lotRule: 'Fixed lot', lotSize: 6, leadTimeDays: 26, leadTimeSdDays: 5,
    primary: 'S-15', backups: ['S-12'], substitutes: [], priceTrendPct: 1.3, targetCoverDays: 40, notes: 'Planned maintenance consumable.' },
]

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export interface SupSpec {
  id: string; name: string; city: string; region: RegionName | 'Import'
  lead: number; leadSd: number; otif: number; quality: number; priceVar: number
  terms: string; capacity: number; risk: 'Low' | 'Medium' | 'High'
  certs: string[]; contact: string; review: string
}

export const SUPPLIER_SPECS: SupSpec[] = [
  { id: 'S-01', name: 'Supplier A — Bulk Alloys', city: 'Western industrial belt', region: 'West',
    lead: 21, leadSd: 4, otif: 91, quality: 98.6, priceVar: -1.2, terms: '45 days', capacity: 1800, risk: 'Low',
    certs: ['ISO 9001', 'ISO 14001'], contact: 'Key account manager', review: 'Steady performer. Holds buffer stock for us on the high-carbon grade.' },
  { id: 'S-02', name: 'Supplier B — Imported Alloys', city: 'Port-based importer', region: 'Import',
    lead: 42, leadSd: 7, otif: 78, quality: 99.1, priceVar: 4.6, terms: '60 days (LC)', capacity: 400, risk: 'High',
    certs: ['ISO 9001'], contact: 'Import desk', review: 'Long lead time and customs exposure. Reliable quality, unreliable dates.' },
  { id: 'S-03', name: 'Supplier C — Specialty Alloys', city: 'Southern industrial belt', region: 'South',
    lead: 12, leadSd: 2.5, otif: 94, quality: 98.9, priceVar: 8.4, terms: '30 days', capacity: 180, risk: 'Low',
    certs: ['ISO 9001', 'IATF 16949'], contact: 'Technical sales', review: 'Domestic, fast and dependable, but roughly 8% dearer. Our standard expedite route.' },
  { id: 'S-04', name: 'Supplier D — Scrap Processing', city: 'Western industrial belt', region: 'West',
    lead: 9, leadSd: 2.5, otif: 88, quality: 96.2, priceVar: 2.1, terms: '21 days', capacity: 3200, risk: 'Medium',
    certs: ['ISO 9001'], contact: 'Yard manager', review: 'Volume is fine; grade consistency varies by consignment.' },
  { id: 'S-05', name: 'Supplier E — Scrap & Recycling', city: 'Northern industrial belt', region: 'North',
    lead: 12, leadSd: 3, otif: 84, quality: 95.4, priceVar: -0.8, terms: '21 days', capacity: 2400, risk: 'Medium',
    certs: [], contact: 'Commercial head', review: 'Cheapest source. Rejection rate is the highest in the panel.' },
  { id: 'S-06', name: 'Supplier F — Industrial Gases', city: 'On-site plant', region: 'West',
    lead: 4, leadSd: 1, otif: 97, quality: 99.7, priceVar: 0.6, terms: '30 days', capacity: 9999, risk: 'Low',
    certs: ['ISO 9001', 'ISO 45001'], contact: 'Site engineer', review: 'Pipeline and tanker supply. Best on-time record of any supplier.' },
  { id: 'S-07', name: 'Supplier G — Flux & Lime', city: 'Eastern industrial belt', region: 'East',
    lead: 7, leadSd: 1.5, otif: 93, quality: 97.8, priceVar: -0.4, terms: '30 days', capacity: 2200, risk: 'Low',
    certs: ['ISO 9001'], contact: 'Despatch coordinator', review: 'Short lead time lets us hold very little lime, which suits its shelf life.' },
  { id: 'S-08', name: 'Supplier H — Process Chemicals', city: 'Western industrial belt', region: 'West',
    lead: 14, leadSd: 3, otif: 89, quality: 98.2, priceVar: 2.8, terms: '45 days', capacity: 900, risk: 'Medium',
    certs: ['ISO 9001', 'ISO 14001'], contact: 'Area sales manager', review: 'Broad catalogue. Occasional short-shipments on rolling oil.' },
  { id: 'S-09', name: 'Supplier I — Acids', city: 'Southern industrial belt', region: 'South',
    lead: 11, leadSd: 2.5, otif: 86, quality: 98.8, priceVar: 3.9, terms: '30 days', capacity: 600, risk: 'High',
    certs: ['ISO 9001', 'Responsible Care'], contact: 'Hazardous logistics desk', review: 'Only approved source for hydrofluoric acid. Single-source risk is on the register.' },
  { id: 'S-10', name: 'Supplier J — Refractories', city: 'Eastern industrial belt', region: 'East',
    lead: 22, leadSd: 5, otif: 90, quality: 97.4, priceVar: 1.4, terms: '45 days', capacity: 1100, risk: 'Medium',
    certs: ['ISO 9001'], contact: 'Technical service', review: 'Good lining life. Delivery slips during their own kiln maintenance.' },
  { id: 'S-11', name: 'Supplier K — Electrodes & Consumables', city: 'Port-based importer', region: 'Import',
    lead: 30, leadSd: 6, otif: 82, quality: 98.0, priceVar: 5.1, terms: '60 days (LC)', capacity: 220, risk: 'High',
    certs: ['ISO 9001'], contact: 'Import desk', review: 'Electrode prices are rising fastest in the panel. Worth dual-sourcing.' },
  { id: 'S-12', name: 'Supplier L — Rolls & Grinding', city: 'Western industrial belt', region: 'West',
    lead: 56, leadSd: 10, otif: 87, quality: 99.3, priceVar: 2.2, terms: '60 days', capacity: 40, risk: 'Medium',
    certs: ['ISO 9001', 'ISO 45001'], contact: 'Engineering manager', review: 'Excellent quality. Lead time is the constraint, not reliability.' },
  { id: 'S-13', name: 'Supplier M — Packaging', city: 'Western industrial belt', region: 'West',
    lead: 11, leadSd: 2, otif: 95, quality: 98.4, priceVar: -1.6, terms: '30 days', capacity: 2600, risk: 'Low',
    certs: ['ISO 9001'], contact: 'Account executive', review: 'Consolidating strap and sleeve volumes here saved about 8% last year.' },
  { id: 'S-14', name: 'Supplier N — Packaging & Timber', city: 'Eastern industrial belt', region: 'East',
    lead: 8, leadSd: 2.5, otif: 79, quality: 95.9, priceVar: 1.1, terms: '21 days', capacity: 1400, risk: 'High',
    certs: [], contact: 'Proprietor', review: 'Skid supply dries up during monsoon. Worst on-time record in the panel.' },
  { id: 'S-15', name: 'Supplier O — Spares & Bearings', city: 'Northern industrial belt', region: 'North',
    lead: 45, leadSd: 9, otif: 92, quality: 99.0, priceVar: 1.9, terms: '45 days', capacity: 90, risk: 'Medium',
    certs: ['ISO 9001'], contact: 'Service engineer', review: 'Dependable for planned spares. Not an option for breakdowns.' },
]

// ---------------------------------------------------------------------------
// Bill of materials (how much of each material per tonne of finished product)
// ---------------------------------------------------------------------------

/** Per tonne of liquid-to-finished product, by grade. Quantities in the material's own unit. */
export const BOM_BY_GRADE: Record<Grade, Record<string, number>> = {
  '304':  { 'RM-101': 0.820, 'RM-102': 0.185, 'RM-104': 0.084, 'RM-106': 0.012, 'RM-107': 0.006,
            'RM-111': 0.055, 'RM-112': 0.025, 'RM-113': 0.008 },
  '316L': { 'RM-101': 0.790, 'RM-103': 0.180, 'RM-104': 0.112, 'RM-105': 0.028, 'RM-106': 0.012,
            'RM-107': 0.006, 'RM-111': 0.055, 'RM-112': 0.025, 'RM-113': 0.008 },
  // 430 is dual-stabilised: titanium and niobium together. Niobium was listed in
  // the material catalogue as an approved stabiliser and a substitute for
  // ferrotitanium, but appeared in no recipe at all — so its usage computed as
  // zero, and dividing stock by zero usage reported 91,400 days of cover.
  '430':  { 'RM-101': 0.870, 'RM-102': 0.172, 'RM-106': 0.009, 'RM-107': 0.006, 'RM-108': 0.003,
            'RM-109': 0.0012, 'RM-111': 0.055, 'RM-112': 0.025, 'RM-113': 0.008 },
  '201':  { 'RM-101': 0.855, 'RM-102': 0.158, 'RM-104': 0.042, 'RM-106': 0.078, 'RM-107': 0.006,
            'RM-111': 0.055, 'RM-112': 0.025, 'RM-113': 0.008 },
}

/** Needed for every tonne regardless of grade. */
export const BOM_COMMON: Record<string, number> = {
  'RM-110': 1.5, 'RM-114': 12, 'RM-115': 8, 'RM-116': 48, 'RM-117': 6,
  'RM-125': 0.004, 'RM-126': 0.8, 'RM-127': 0.03, 'RM-128': 1.2, 'RM-124': 6,
  'RM-134': 2.2, 'RM-135': 0.12, 'RM-136': 1.4, 'RM-137': 0.10, 'RM-138': 0.5,
}

/** Extra materials needed depending on how the coil is finished. */
export const BOM_BY_FORM: Record<Form, Record<string, number>> = {
  'Cold-rolled coil': { 'RM-118': 9, 'RM-119': 3.5, 'RM-120': 4, 'RM-121': 0.4, 'RM-122': 1.8,
                        'RM-123': 0.3, 'RM-129': 0.0012, 'RM-130': 0.00004, 'RM-131': 0.0009, 'RM-139': 0.00008, 'RM-140': 0.0004 },
  'Sheet':            { 'RM-118': 8, 'RM-119': 3.0, 'RM-120': 3.5, 'RM-121': 0.35, 'RM-122': 1.5,
                        'RM-123': 0.3, 'RM-129': 0.0010, 'RM-130': 0.00003, 'RM-131': 0.0008, 'RM-139': 0.00007, 'RM-140': 0.0004 },
  'Hot-rolled coil':  { 'RM-118': 4, 'RM-119': 1.5, 'RM-120': 2, 'RM-121': 0.2, 'RM-123': 0.2, 'RM-140': 0.0002 },
}

export const BOM_BY_FINISH: Record<Finish, Record<string, number>> = {
  '2B':   {},
  'BA':   { 'RM-115': 4 },
  'No.1': {},
  'No.4': { 'RM-132': 0.020 },
  'HL':   { 'RM-133': 0.60, 'RM-132': 0.008 },
}

/**
 * Conversion cost per tonne: labour, energy, furnace time, roll wear and
 * overhead on top of the metal itself.
 *
 * Cold rolling adds passes, an anneal and a pickle over hot rolling; sheet adds
 * cutting and handling on top of that.
 */
export const CONVERSION_COST_PER_T: Record<Form, number> = {
  'Hot-rolled coil': 14000,
  'Cold-rolled coil': 26000,
  'Sheet': 32000,
}

export const CUSTOMER_INDUSTRIES = [
  'Automotive', 'Pharmaceuticals', 'Food processing', 'Construction',
  'Appliances', 'Railways', 'Chemicals', 'Heavy engineering',
] as const
