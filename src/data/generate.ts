/**
 * Builds the whole demo data set from a fixed seed.
 *
 * The important part: the story is built into the *history*, not typed into the screens.
 *   - 316L demand in the South region jumps about +35% over the last three weeks.
 *   - Grade 430 has been falling all year.
 * Everything the app shows afterwards (anomalies, material needs, stock risk,
 * purchase recommendations) is then calculated from this history by the engine.
 */
import { Rng } from '@/lib/rng'
import { addWeeks, clamp, mean } from '@/lib/format'
import type {
  Dataset, Sku, Material, Supplier, Customer, CustomerOrder, PurchaseOrder,
  MarketSignal, CommodityPoint, BomLine, DemandSeries, PlanHistoryEntry,
  Grade, Form, Finish, RegionName, Lifecycle, ABC, XYZ, OrderStatus, POStatus,
} from './types'
import {
  GRADES, FORMS, THICKNESS, FINISHES, REGION_NAMES, REGIONS, WAREHOUSES, PLANTS, LINES,
  MATERIAL_SPECS, SUPPLIER_SPECS, BOM_BY_GRADE, BOM_COMMON, BOM_BY_FORM, BOM_BY_FINISH,
  CONVERSION_COST_PER_T, CUSTOMER_INDUSTRIES,
} from './catalog'

export const HISTORY_WEEKS = 104
export const TODAY_WEEK = HISTORY_WEEKS           // week index 104 = "this week"
export const HORIZON_WEEKS = 26                   // how far forward we plan
/**
 * Weeks of demand generated *past* today. They are real figures, held back
 * until the planner advances the week, which is what gives the Advance control
 * something to reveal. Must cover the control's maximum of 12 steps.
 */
export const FUTURE_WEEKS = 13
/** Monday of whichever week contains the real today, so the dates always read as current. */
function mondayOfThisWeek(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))   // getDay(): 0 = Sunday
  return d
}
export const DEMO_TODAY = mondayOfThisWeek()
/** The real calendar date, for the clock in the top bar. */
export const REAL_TODAY = new Date()
export const TOTAL_WEEKLY_TONNES = 3800

/**
 * History starts 104 weeks before the demo date, which is the last week of October 2024 —
 * roughly calendar week 44. Offsetting the seasonal index by this keeps the festive peak in
 * October–November and the monsoon dip in June–August, where they belong.
 */
export const WOY_OFFSET = 44

/** The three weeks over which the South 316L shift happened. */
export const STORY = {
  anomalyStartWeek: TODAY_WEEK - 3,   // 101
  anomalyGrade: '316L' as Grade,
  anomalyRegion: 'South' as RegionName,
  anomalyUplift: 0.35,
  decliningGrade: '430' as Grade,
  criticalMaterial: 'RM-105',         // Ferromolybdenum
  excessMaterial: 'RM-102',           // Ferrochrome (high carbon)
  rescueSupplier: 'S-03',             // Supplier C — Specialty Alloys
}

// --- weights that shape how much each SKU sells ------------------------------
const GRADE_W: Record<Grade, number> = { '304': 0.42, '316L': 0.22, '430': 0.22, '201': 0.14 }
const FORM_W: Record<Form, number> = { 'Cold-rolled coil': 0.50, 'Hot-rolled coil': 0.30, 'Sheet': 0.20 }
const THICK_W: Record<number, number> = { 0.5: 0.20, 1.0: 0.35, 2.0: 0.28, 3.0: 0.17 }
const FINISH_W: Record<Finish, number> = { '2B': 0.40, 'BA': 0.15, 'No.1': 0.20, 'No.4': 0.15, 'HL': 0.10 }

const GRADE_PRICE: Record<Grade, number> = { '304': 252000, '316L': 368000, '430': 168000, '201': 186000 }
const FORM_PRICE_ADJ: Record<Form, number> = { 'Cold-rolled coil': 1.0, 'Hot-rolled coil': 0.86, 'Sheet': 1.07 }
const FINISH_PRICE_ADJ: Record<Finish, number> = { '2B': 1.0, 'BA': 1.09, 'No.1': 0.94, 'No.4': 1.12, 'HL': 1.15 }

const GRADE_INDUSTRIES: Record<Grade, string[]> = {
  '304': ['Automotive', 'Appliances', 'Construction', 'Heavy engineering'],
  '316L': ['Pharmaceuticals', 'Food processing', 'Chemicals'],
  '430': ['Appliances', 'Automotive', 'Construction'],
  '201': ['Appliances', 'Construction', 'Railways'],
}

function skuCode(g: Grade, f: Form, t: number, fin: Finish) {
  const formCode = f === 'Cold-rolled coil' ? 'CR' : f === 'Hot-rolled coil' ? 'HR' : 'SH'
  return `SS-${g}-${formCode}-${t.toFixed(1)}-${fin}`
}

// =============================================================================
// SKUs
// =============================================================================
function buildSkus(rng: Rng): Sku[] {
  const skus: Sku[] = []
  let n = 0
  for (const grade of GRADES) {
    for (const form of FORMS) {
      for (const th of THICKNESS) {
        for (const finish of FINISHES) {
          n++
          const weight = GRADE_W[grade] * FORM_W[form] * THICK_W[th] * FINISH_W[finish]

          // Lifecycle: 430 skews to declining; 316L skews to growing.
          let lifecycle: Lifecycle
          const r = rng.next()
          if (grade === '430') lifecycle = r < 0.62 ? 'Declining' : r < 0.9 ? 'Mature' : 'Growing'
          else if (grade === '316L') lifecycle = r < 0.46 ? 'Growing' : r < 0.78 ? 'Mature' : r < 0.9 ? 'New' : 'Declining'
          else lifecycle = r < 0.18 ? 'Growing' : r < 0.82 ? 'Mature' : r < 0.93 ? 'Declining' : 'New'

          const historyStartWeek = lifecycle === 'New' ? rng.int(58, 76) : 0
          const lumpy = weight < 0.0022 && rng.chance(0.45)

          const pricePerT = Math.round(
            GRADE_PRICE[grade] * FORM_PRICE_ADJ[form] * FINISH_PRICE_ADJ[finish] *
            (th <= 0.5 ? 1.08 : th >= 3 ? 0.96 : 1) * rng.range(0.98, 1.02) / 100) * 100
          const marginPct = rng.range(8.5, 17.5)
          const costPerT = Math.round(pricePerT * (1 - marginPct / 100))

          const abc: ABC = weight > 0.0062 ? 'A' : weight > 0.0032 ? 'B' : 'C'
          const xyz: XYZ = lumpy ? 'Z' : lifecycle === 'Mature' ? 'X' : rng.chance(0.5) ? 'Y' : 'X'

          const mainRegions = grade === '316L'
            ? (['South', 'West'] as RegionName[])
            : grade === '430' ? (['North', 'West'] as RegionName[])
            : rng.shuffle([...REGION_NAMES]).slice(0, 2)

          skus.push({
            id: `SKU-${String(n).padStart(3, '0')}`,
            code: skuCode(grade, form, th, finish),
            name: `${grade} ${form}, ${th.toFixed(1)} mm, ${finish} finish`,
            grade, form, thicknessMm: th,
            widthMm: form === 'Sheet' ? rng.pick([1000, 1219, 1250]) : rng.pick([1000, 1219, 1250, 1500]),
            finish, unit: 't', pricePerT, costPerT, marginPct,
            abc, xyz, lifecycle, historyStartWeek, lumpy,
            mainRegions,
            mainIndustries: GRADE_INDUSTRIES[grade].slice(0, 3),
            handlingNote: finish === 'BA' || finish === 'No.4' || finish === 'HL'
              ? 'Surface-critical. Interleaving paper and VCI wrap mandatory; do not stack unprotected.'
              : 'Standard coil handling. Keep dry, strap before despatch.',
            lineIds: form === 'Hot-rolled coil' ? ['LN-1', 'LN-2'] :
                     form === 'Sheet' ? ['LN-1', 'LN-2', 'LN-3', 'LN-4', 'LN-5'] :
                     ['LN-1', 'LN-2', 'LN-3', 'LN-4'],
          })
        }
      }
    }
  }
  return skus
}

// =============================================================================
// Weekly demand history — 104 weeks per SKU per region
// =============================================================================
interface AnomalyEpisode {
  skuId: string; region: RegionName; startWeek: number; weeks: number; size: number; cause: string
}

function buildDemand(rng: Rng, skus: Sku[]) {
  const totalWeight = skus.reduce((s, k) =>
    s + GRADE_W[k.grade] * FORM_W[k.form] * THICK_W[k.thicknessMm] * FINISH_W[k.finish], 0)

  const episodes: AnomalyEpisode[] = []
  const causes = [
    'Large project order from a single customer',
    'Competitor plant shutdown pushed volume to us',
    'Channel stocking ahead of an announced price rise',
    'Customer brought a build programme forward',
    'Export enquiry converted at short notice',
    'Monsoon disruption delayed despatches into the next week',
    'Customer quality hold paused offtake',
    'One-off tender win',
  ]

  // 24 historical anomaly episodes scattered across the two years
  const bigSkus = skus.filter(s => s.abc !== 'C')
  for (let i = 0; i < 24; i++) {
    episodes.push({
      skuId: rng.pick(bigSkus).id,
      region: rng.pick(REGION_NAMES),
      startWeek: rng.int(14, HISTORY_WEEKS - 10),
      weeks: rng.int(2, 4),
      size: rng.chance(0.62) ? rng.range(0.28, 0.72) : -rng.range(0.24, 0.5),
      cause: rng.pick(causes),
    })
  }

  const demand: DemandSeries[] = []
  const regionShare: Record<RegionName, number> = { North: 0.26, South: 0.30, East: 0.18, West: 0.26 }

  /** Everything one SKU-region series needs, kept for the second pass below. */
  interface Spec {
    sku: Sku
    region: RegionName
    weeks: number[]
    base: number
    trendPerWeek: number
    seasAmp: number
    phase: number
    noiseSd: number
    constructionLinked: boolean
  }
  const specs: Spec[] = []

  /** One week of demand before noise, or null before the SKU existed. */
  const shape = (s: Spec, t: number): number | null => {
    const { sku, region } = s
    if (t < sku.historyStartWeek) return null

    let v = s.base * Math.pow(1 + s.trendPerWeek, t - sku.historyStartWeek)
    v *= 1 + s.seasAmp * Math.sin((2 * Math.PI * (t + s.phase)) / 52)

    // Week of the actual calendar year, not just the index — otherwise the
    // festive peak and the monsoon dip land in the wrong months.
    const woy = (t + WOY_OFFSET) % 52
    if (woy >= 40 && woy <= 45) v *= 1.14                              // festive build-up (Oct–Nov)
    if (s.constructionLinked && woy >= 24 && woy <= 33) v *= 0.87      // monsoon slow-down (Jun–Aug)
    if (woy === 0 || woy === 51) v *= 0.78                             // year-end shutdown

    // Grade 430 structural decline over the last six months, carrying on into
    // the weeks nobody has reached yet. Floored, because a declining grade
    // loses share — it does not stop selling altogether.
    if (sku.grade === '430' && t >= HISTORY_WEEKS - 26) {
      v *= Math.max(0.55, 1 - 0.011 * (t - (HISTORY_WEEKS - 26)))
    }

    // historical anomaly episodes
    for (const e of episodes) {
      if (e.skuId === sku.id && e.region === region && t >= e.startWeek && t < e.startWeek + e.weeks) {
        v *= 1 + e.size
      }
    }

    // ---- THE STORY: South 316L steps up over the last three weeks, and stays
    // up, because it is a change in the market rather than a blip.
    if (sku.grade === STORY.anomalyGrade && region === STORY.anomalyRegion && t >= STORY.anomalyStartWeek) {
      const step = Math.min(t - STORY.anomalyStartWeek, 2)            // 0,1,2
      v *= 1 + STORY.anomalyUplift * [0.72, 1.0, 1.12][step]
    }
    return v
  }

  for (const sku of skus) {
    const w = GRADE_W[sku.grade] * FORM_W[sku.form] * THICK_W[sku.thicknessMm] * FINISH_W[sku.finish]
    const skuWeeklyTotal = (w / totalWeight) * TOTAL_WEEKLY_TONNES

    // How this SKU's demand drifts week on week
    const trendPerWeek =
      sku.lifecycle === 'Growing' ? rng.range(0.0022, 0.0055) :
      sku.lifecycle === 'New' ? rng.range(0.006, 0.013) :
      sku.lifecycle === 'Declining' ? -rng.range(0.0025, 0.0062) :
      rng.range(-0.0006, 0.0010)

    const seasAmp = sku.grade === '430' || sku.grade === '201' ? rng.range(0.14, 0.24) : rng.range(0.06, 0.15)
    const phase = rng.range(0, 52)
    const noiseSd = sku.xyz === 'X' ? 0.075 : sku.xyz === 'Y' ? 0.15 : 0.42
    const constructionLinked = sku.grade === '430' || sku.grade === '201'

    for (const region of REGION_NAMES) {
      const tilt = sku.mainRegions.includes(region) ? rng.range(1.25, 1.65) : rng.range(0.55, 0.92)
      const spec: Spec = {
        sku, region, weeks: [], base: skuWeeklyTotal * regionShare[region] * tilt,
        trendPerWeek, seasAmp, phase, noiseSd, constructionLinked,
      }

      for (let t = 0; t < HISTORY_WEEKS; t++) {
        const v = shape(spec, t)
        if (v === null) { spec.weeks.push(0); continue }
        const noisy = v * Math.exp(rng.normal(0, noiseSd) - (noiseSd * noiseSd) / 2)
        // lumpy SKUs sell in bursts
        spec.weeks.push(sku.lumpy && rng.chance(0.55) ? 0 : Math.max(0, +noisy.toFixed(2)))
      }

      specs.push(spec)
      demand.push({ skuId: sku.id, region, weeks: spec.weeks })
    }
  }

  // The weeks past today, drawn from a stream of their own. Taking them from
  // `rng` inside the loop above would shift every number generated after it —
  // stock, suppliers, orders, the whole tuned story — so they go here instead.
  const frng = new Rng(910_357)
  for (const s of specs) {
    for (let t = HISTORY_WEEKS; t < HISTORY_WEEKS + FUTURE_WEEKS; t++) {
      const v = shape(s, t)
      if (v === null) { s.weeks.push(0); continue }
      const noisy = v * Math.exp(frng.normal(0, s.noiseSd) - (s.noiseSd * s.noiseSd) / 2)
      s.weeks.push(s.sku.lumpy && frng.chance(0.55) ? 0 : Math.max(0, +noisy.toFixed(2)))
    }
  }

  return { demand, episodes }
}

// =============================================================================
// Bill of materials per SKU
// =============================================================================
function buildBom(skus: Sku[]): Record<string, BomLine[]> {
  const bom: Record<string, BomLine[]> = {}
  for (const sku of skus) {
    const merged: Record<string, number> = {}
    const add = (src: Record<string, number>) => {
      for (const [k, v] of Object.entries(src)) merged[k] = (merged[k] ?? 0) + v
    }
    add(BOM_BY_GRADE[sku.grade])
    add(BOM_COMMON)
    add(BOM_BY_FORM[sku.form])
    add(BOM_BY_FINISH[sku.finish])
    // thinner gauge needs more rolling passes
    if (sku.thicknessMm <= 0.5 && merged['RM-122']) merged['RM-122'] *= 1.35
    if (sku.thicknessMm <= 0.5 && merged['RM-129']) merged['RM-129'] *= 1.4

    bom[sku.id] = Object.entries(merged).map(([materialId, qtyPerTonne]) => ({
      materialId,
      qtyPerTonne: +qtyPerTonne.toFixed(6),
      scrapPct: materialId.startsWith('RM-1') && ['RM-118', 'RM-119', 'RM-122'].includes(materialId) ? 4 : 2,
    }))
  }
  return bom
}

/**
 * Cost of the metal in one tonne of a product, straight off its own recipe.
 * Scrap allowance included, because you buy what you lose as well.
 */
export function recipeCostPerT(lines: BomLine[]): number {
  return lines.reduce((t, l) => {
    const spec = MATERIAL_SPECS.find(m => m.code === l.materialId)
    return t + l.qtyPerTonne * (1 + l.scrapPct / 100) * (spec?.cost ?? 0)
  }, 0)
}

/**
 * Price each product up from what it actually costs to make.
 *
 * Price and cost used to be drawn from grade and form tables with no reference
 * to the bill of materials, and the two disagreed badly: 170 of the 240
 * products sold for less than the metal in them, and the stated cost per tonne
 * was unrelated to the recipe. Nothing displayed both figures together, so it
 * stayed invisible until the Plan screen started totalling a recipe.
 *
 * The recipe is the only honest source for cost, so cost comes from it and
 * price follows, keeping each product's own margin. Relative pricing across
 * grades and finishes still works out, because the recipes differ in exactly
 * the ways the old price table was approximating — 316L carries molybdenum and
 * more nickel, 430 carries none.
 */
function repriceFromRecipe(skus: Sku[], bom: Record<string, BomLine[]>) {
  for (const sku of skus) {
    const metal = recipeCostPerT(bom[sku.id] ?? [])
    const full = metal + CONVERSION_COST_PER_T[sku.form]
    sku.costPerT = Math.round(full)
    sku.pricePerT = Math.round(full / (1 - sku.marginPct / 100) / 100) * 100
  }
}

// =============================================================================
// Materials — on-hand stock is set from real recent usage so the story holds
// =============================================================================
function buildMaterials(
  rng: Rng, skus: Sku[], demand: DemandSeries[], bom: Record<string, BomLine[]>,
): Material[] {
  // average weekly usage of each material over the last 8 weeks of history
  const usage: Record<string, number> = {}
  const recentBySku: Record<string, number> = {}
  for (const d of demand) {
    const recent = mean(d.weeks.slice(HISTORY_WEEKS - 8, HISTORY_WEEKS))
    recentBySku[d.skuId] = (recentBySku[d.skuId] ?? 0) + recent
  }
  for (const sku of skus) {
    const t = recentBySku[sku.id] ?? 0
    for (const line of bom[sku.id]) {
      usage[line.materialId] = (usage[line.materialId] ?? 0) + t * line.qtyPerTonne * (1 + line.scrapPct / 100)
    }
  }

  const skusUsing: Record<string, Set<Grade>> = {}
  for (const sku of skus) for (const l of bom[sku.id]) {
    ;(skusUsing[l.materialId] ??= new Set()).add(sku.grade)
  }

  /**
   * How much stock a material would sensibly be holding: enough to cover its own
   * lead time, the variability in that lead time, and one ordering cycle.
   * Starting the demo below this for everything would make the whole plant look
   * broken, which tells you nothing. The two story materials deliberately sit
   * outside it — that is the point of the demo.
   */
  const STORY_COVER: Record<string, number> = {
    [STORY.criticalMaterial]: 24,  // ferromolybdenum — about four weeks, against a six-week lead time
    [STORY.excessMaterial]: 95,    // ferrochrome — far more than the falling 430 demand needs
    'RM-135': 11,                  // wooden skid — chronically short, as the supplier note says
  }

  return MATERIAL_SPECS.map(spec => {
    const weekly = usage[spec.code] ?? 1
    const daily = weekly / 7
    const naturalCover = spec.leadTimeDays + 2 * spec.leadTimeSdDays + 14
    const coverDays = STORY_COVER[spec.code] ?? Math.max(spec.targetCoverDays, naturalCover)
    const onHandTotal = daily * coverDays

    // split stock across the warehouses that actually hold it
    const holdWh = ['Packaging'].includes(spec.category)
      ? ['WH-W1', 'WH-S1', 'WH-N1', 'WH-E1']
      : ['WH-W1', 'WH-S1']
    const onHandByWh: Record<string, number> = {}
    let left = onHandTotal
    holdWh.forEach((wh, i) => {
      const share = i === holdWh.length - 1 ? left : onHandTotal * (i === 0 ? 0.56 : 0.2)
      onHandByWh[wh] = +Math.max(0, share).toFixed(2)
      left -= share
    })

    return {
      id: spec.code, code: spec.code, name: spec.name, category: spec.category, unit: spec.unit,
      costPerUnit: spec.cost, abc: (weekly * spec.cost > 2.2e6 ? 'A' : weekly * spec.cost > 4e5 ? 'B' : 'C') as ABC,
      critical: spec.critical, shelfLifeDays: spec.shelfLifeDays, storage: spec.storage,
      moq: spec.moq, lotRule: spec.lotRule, lotSize: spec.lotSize,
      leadTimeDays: spec.leadTimeDays, leadTimeSdDays: spec.leadTimeSdDays,
      primarySupplierId: spec.primary, backupSupplierIds: spec.backups, substituteIds: spec.substitutes,
      priceTrendPct: spec.priceTrendPct,
      onHandByWh,
      onOrder: rng.chance(0.42) ? +(daily * rng.range(6, 20)).toFixed(2) : 0,
      // the old fixed rule the planner used to run on — deliberately crude
      staticMinLevel: +(daily * (spec.critical ? 14 : 10)).toFixed(2),
      usedByGrades: [...(skusUsing[spec.code] ?? [])],
      notes: spec.notes,
    }
  })
}

// =============================================================================
// Suppliers, customers, orders, purchase orders, signals
// =============================================================================
function buildSuppliers(rng: Rng, materials: Material[]): Supplier[] {
  return SUPPLIER_SPECS.map(s => ({
    id: s.id, name: s.name, city: s.city, region: s.region,
    materialIds: materials.filter(m => m.primarySupplierId === s.id || m.backupSupplierIds.includes(s.id)).map(m => m.id),
    leadTimeDays: s.lead, leadTimeSdDays: s.leadSd, otifPct: s.otif, qualityPct: s.quality,
    priceVariancePct: s.priceVar, paymentTerms: s.terms, monthlyCapacity: s.capacity, risk: s.risk,
    certifications: s.certs, contactRole: s.contact, lastReview: s.review,
    scoreTrend: Array.from({ length: 12 }, (_, i) =>
      Math.round(clamp(s.otif * 0.6 + s.quality * 0.4 + rng.normal(0, 2.2) + i * 0.12, 55, 99))),
  }))
}

function buildCustomers(rng: Rng): Customer[] {
  const out: Customer[] = []
  for (let i = 0; i < 60; i++) {
    const industry = CUSTOMER_INDUSTRIES[i % CUSTOMER_INDUSTRIES.length]
    const region = REGION_NAMES[i % 4]
    out.push({
      id: `CUS-${String(i + 1).padStart(3, '0')}`,
      name: `Customer ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) + 1} — ${industry}`,
      industry, region,
      since: rng.int(2009, 2024),
      creditDays: rng.pick([21, 30, 45, 60]),
      annualTonnage: Math.round(rng.range(400, 14000)),
      deliveryPerfPct: +rng.range(82, 99).toFixed(1),
    })
  }
  return out
}

function buildOrders(rng: Rng, skus: Sku[], customers: Customer[], demand: DemandSeries[]): CustomerOrder[] {
  const out: CustomerOrder[] = []
  const bySku = new Map(skus.map(s => [s.id, s]))
  let n = 0
  // Orders are drawn from the real recent demand so the order book matches the history.
  for (const d of demand) {
    const sku = bySku.get(d.skuId)!
    for (let w = HISTORY_WEEKS - 12; w < HISTORY_WEEKS + 6; w++) {
      // Deliberately the trailing average past today, not the real figure that
      // now exists there: whether a week clears the 0.4 t floor below decides
      // how many random draws this loop takes, and every number generated after
      // it — purchase orders, signals, the tuned story — rides on that stream.
      const base = w < HISTORY_WEEKS ? d.weeks[w] : mean(d.weeks.slice(HISTORY_WEEKS - 6, HISTORY_WEEKS))
      if (base <= 0.4) continue
      if (!rng.chance(0.16)) continue
      n++
      const qtyT = +(base * rng.range(0.3, 0.9)).toFixed(1)
      if (qtyT < 0.3) continue
      const cands = customers.filter(c => c.region === d.region && sku.mainIndustries.includes(c.industry))
      const cust = cands.length ? rng.pick(cands) : rng.pick(customers.filter(c => c.region === d.region))
      const pricePerT = Math.round(sku.pricePerT * rng.range(0.96, 1.05))
      const promisedWeek = w + rng.int(1, 5)
      let status: OrderStatus
      if (promisedWeek < TODAY_WEEK - 2) status = 'Delivered'
      else if (promisedWeek < TODAY_WEEK) status = rng.chance(0.7) ? 'Delivered' : 'Dispatched'
      else if (w < TODAY_WEEK) status = rng.chance(0.45) ? 'In production' : 'Confirmed'
      else status = 'Open'
      out.push({
        id: `SO-${String(10000 + n)}`,
        customerId: cust.id, skuId: sku.id, region: d.region, qtyT, pricePerT,
        valueINR: Math.round(qtyT * pricePerT),
        orderWeek: w, promisedWeek, status,
        priority: sku.abc === 'A' && rng.chance(0.35) ? 'High' : rng.chance(0.2) ? 'Low' : 'Normal',
        onTime: status === 'Delivered' ? rng.chance(0.93) : null,
      })
    }
  }
  return out
}

function buildPurchaseOrders(rng: Rng, materials: Material[], suppliers: Supplier[]): PurchaseOrder[] {
  const out: PurchaseOrder[] = []
  let n = 0
  for (const m of materials) {
    const count = m.critical ? rng.int(6, 9) : rng.int(3, 6)
    for (let i = 0; i < count; i++) {
      n++
      const sup = suppliers.find(s => s.id === m.primarySupplierId)!
      const orderWeek = rng.int(TODAY_WEEK - 26, TODAY_WEEK + 1)
      const leadW = Math.round(m.leadTimeDays / 7)
      const promisedWeek = orderWeek + leadW
      const slip = rng.chance(1 - sup.otifPct / 100) ? rng.int(1, 3) : 0
      const expectedWeek = promisedWeek + slip
      let status: POStatus
      if (expectedWeek < TODAY_WEEK) status = 'Received'
      else if (orderWeek > TODAY_WEEK - 1) status = rng.chance(0.5) ? 'Approved' : 'Sent'
      else if (expectedWeek - TODAY_WEEK <= 1) status = 'In transit'
      else status = rng.chance(0.6) ? 'Confirmed' : 'Sent'
      const qty = +(m.moq * rng.range(1, 3.2)).toFixed(2)
      const price = Math.round(m.costPerUnit * rng.range(0.97, 1.06))
      out.push({
        id: `PO-${String(4200 + n)}`,
        supplierId: sup.id, materialId: m.id, qty, pricePerUnit: price,
        valueINR: Math.round(qty * price),
        orderWeek, promisedWeek, expectedWeek, neededWeek: promisedWeek + rng.int(0, 2),
        status,
        receivedPct: status === 'Received' ? 100 : status === 'In transit' ? rng.int(0, 40) : 0,
        payment: status === 'Received' ? (rng.chance(0.75) ? 'Paid' : 'Partial') : 'Pending',
        linkedRecommendationId: null,
        raisedBy: rng.pick(['A. Rao (Procurement)', 'S. Nair (Procurement)', 'System recommendation']),
        note: slip > 0 ? `Supplier advised a ${slip}-week slip against the promised date.` : 'On schedule.',
      })
    }
  }
  return out
}

function buildSignals(rng: Rng, weekDates: Date[]): MarketSignal[] {
  const defs: Array<Omit<MarketSignal, 'id' | 'date' | 'read'>> = [
    { week: TODAY_WEEK - 4, title: 'New pharmaceutical and food-processing plants announced in the South region',
      sourceType: 'Industry news', kind: 'Demand', regions: ['South'], grades: ['316L'], materialIds: ['RM-105', 'RM-104', 'RM-103'],
      effectPct: 32, confidence: 0.82, severity: 'High',
      explanation: 'Several process plants were announced in the South. These buyers specify 316L for product-contact surfaces, so South 316L demand should step up over the next two to three quarters. 316L is our only grade that uses molybdenum.' },
    { week: TODAY_WEEK - 2, title: 'Two South-region customers raised their rolling forecast for 316L sheet',
      sourceType: 'Customer intimation', kind: 'Demand', regions: ['South'], grades: ['316L'], materialIds: ['RM-105'],
      effectPct: 18, confidence: 0.91, severity: 'High',
      explanation: 'Direct confirmation from customers that the step-up in orders is a real programme change, not stocking ahead of a price move.' },
    { week: TODAY_WEEK - 1, title: 'Molybdenum index up 9.4% over six weeks',
      sourceType: 'Commodity index', kind: 'Price', regions: [], grades: ['316L'], materialIds: ['RM-105'],
      effectPct: 9.4, confidence: 0.95, severity: 'Medium',
      explanation: 'Ferromolybdenum is our highest-value alloy per tonne. A rising index raises both the cost of cover and the cost of being caught short.' },
    { week: TODAY_WEEK - 3, title: 'Import alloy shipments reporting two-week port congestion',
      sourceType: 'Logistics update', kind: 'Logistics', regions: [], grades: ['316L'], materialIds: ['RM-105', 'RM-104'],
      effectPct: -14, confidence: 0.7, severity: 'High',
      explanation: 'Our imported alloy route already runs a six-week lead time. Congestion makes that date less dependable just as 316L demand rises.' },
    { week: TODAY_WEEK - 6, title: 'Appliance makers shifting from 430 to coated carbon steel on entry models',
      sourceType: 'Industry news', kind: 'Demand', regions: ['North', 'West'], grades: ['430'], materialIds: ['RM-102', 'RM-108'],
      effectPct: -16, confidence: 0.74, severity: 'Medium',
      explanation: 'A structural move away from 430 on price-led models. Lower 430 output means we consume less high-carbon ferrochrome than the old plan assumed.' },
    { week: TODAY_WEEK - 9, title: 'Ferrochrome index down 5.1% on weaker regional demand',
      sourceType: 'Commodity index', kind: 'Price', regions: [], grades: ['304', '430', '201'], materialIds: ['RM-102'],
      effectPct: -5.1, confidence: 0.9, severity: 'Low',
      explanation: 'Falling chrome prices make holding a large ferrochrome stock more expensive in opportunity terms, not less.' },
    { week: TODAY_WEEK - 5, title: 'Timber supplier flagged monsoon disruption to skid supply',
      sourceType: 'Supplier notice', kind: 'Supply', regions: ['East'], grades: [], materialIds: ['RM-135'],
      effectPct: -22, confidence: 0.68, severity: 'Medium',
      explanation: 'Wooden skids come from a single low-reliability supplier. Despatch stops without them, whatever the steel position looks like.' },
    { week: TODAY_WEEK - 7, title: 'Nickel index up 6.2% month on month',
      sourceType: 'Commodity index', kind: 'Price', regions: [], grades: ['304', '316L', '201'], materialIds: ['RM-104'],
      effectPct: 6.2, confidence: 0.93, severity: 'Medium',
      explanation: 'Nickel is the single largest input cost. A sustained rise feeds into both 304 and 316L cost within a quarter.' },
    { week: TODAY_WEEK - 8, title: 'Railway rolling-stock tender awarded in the East region',
      sourceType: 'Industry news', kind: 'Demand', regions: ['East'], grades: ['201', '304'], materialIds: [],
      effectPct: 12, confidence: 0.66, severity: 'Medium',
      explanation: 'Rolling-stock interiors use 201 and 304 sheet. Expect East demand to firm from the next quarter.' },
    { week: TODAY_WEEK - 11, title: 'Acid supplier scheduled plant maintenance for two weeks',
      sourceType: 'Supplier notice', kind: 'Supply', regions: ['South'], grades: [], materialIds: ['RM-118', 'RM-119'],
      effectPct: -30, confidence: 0.88, severity: 'High',
      explanation: 'Hydrofluoric acid has a single approved source. Pickling stops without it, which stops every cold-rolled and sheet product.' },
    { week: TODAY_WEEK - 13, title: 'Automotive build rates revised up for the next two quarters',
      sourceType: 'Industry news', kind: 'Demand', regions: ['North', 'West'], grades: ['304'], materialIds: [],
      effectPct: 8, confidence: 0.71, severity: 'Low',
      explanation: 'Higher build rates lift 304 cold-rolled volumes in the two automotive regions.' },
    { week: TODAY_WEEK - 15, title: 'Electrode prices up 5.2% following an import duty revision',
      sourceType: 'Policy update', kind: 'Price', regions: [], grades: [], materialIds: ['RM-125'],
      effectPct: 5.2, confidence: 0.85, severity: 'Low',
      explanation: 'Graphite electrodes already carry a 30-day lead time from a single importer. Worth a second source.' },
  ]

  /**
   * Background signals.
   *
   * Region, grade and the sign of the effect are written here rather than drawn
   * at random. They used to be rolled independently of the text, so a headline
   * reading "expansion in the West region" could carry an East tag and a
   * negative effect — three statements contradicting each other on one card.
   */
  type Filler = [
    title: string,
    source: MarketSignal['sourceType'],
    kind: MarketSignal['kind'],
    regions: RegionName[],
    grades: Grade[],
    effectPct: number,
    explanation: string,
  ]
  const fillers: Filler[] = [
    ['Regional freight rates eased 4% on the western corridor', 'Logistics update', 'Logistics', ['West'], [], 2.4, 'Lower inbound freight slightly improves landed cost on bulk alloys.'],
    ['Construction output index flat for a third month', 'Industry news', 'Demand', [], ['430', '201'], 0, 'No change expected to 430 and 201 construction volumes.'],
    ['Scrap availability improved after a seasonal collection peak', 'Commodity index', 'Supply', [], [], 5.1, 'Short-term easing in scrap price and lead time.'],
    ['Appliance export orders softened in the North region', 'Customer intimation', 'Demand', ['North'], ['430'], -6.3, 'A small negative read for 430 sheet in the North.'],
    ['Refractory supplier completed kiln maintenance ahead of plan', 'Supplier notice', 'Supply', ['East'], [], 3.0, 'Brick deliveries return to the normal 22-day lead time.'],
    ['Gas supplier confirmed pipeline capacity increase', 'Supplier notice', 'Supply', ['West'], [], 4.2, 'Removes the argon constraint flagged last quarter.'],
    ['Food-processing capital spend guidance raised', 'Industry news', 'Demand', [], ['316L'], 7.5, 'Supports the 316L outlook beyond the current horizon.'],
    ['Customs clearance times lengthened at the western port', 'Logistics update', 'Logistics', ['West'], [], -5.5, 'Adds roughly three days to every imported alloy consignment.'],
    ['Chrome ore supply contract renewed at a lower price', 'Commodity index', 'Price', [], ['304', '430', '201'], -3.8, 'Ferrochrome input cost should ease next quarter.'],
    ['Pharmaceutical capacity expansion confirmed in the West region', 'Industry news', 'Demand', ['West'], ['316L'], 9.2, 'A second region showing 316L strength, though smaller than the South.'],
    ['Packaging supplier consolidated two despatch depots', 'Supplier notice', 'Logistics', ['West'], [], 1.8, 'Strap and sleeve lead time drops by about two days.'],
    ['Energy tariff revision announced for industrial consumers', 'Policy update', 'Price', [], [], 0.6, 'Raises conversion cost across all grades by roughly 0.6%.'],
    ['Competitor announced a cold mill capacity addition', 'Industry news', 'Demand', [], ['304'], -4.5, 'Possible pressure on 304 cold-rolled pricing from next year.'],
    ['Rolling oil formulation change approved by the mill team', 'Supplier notice', 'Supply', [], [], 2.0, 'Marginally lower consumption per tonne on thin gauge.'],
    ['Heavy engineering order intake up in the East region', 'Customer intimation', 'Demand', ['East'], ['304'], 6.8, 'Supports 304 hot-rolled volumes in the East.'],
    ['Nitrogen supply tightening as bright-annealed volumes rise', 'Supplier notice', 'Supply', [], [], -4.0, 'BA finish volumes are pulling more nitrogen than the plan allowed.'],
    ['Port labour agreement settled without disruption', 'Logistics update', 'Logistics', [], [], 1.2, 'Removes a watch item from the import risk list.'],
    ['Two customers requested a move to monthly call-off', 'Customer intimation', 'Demand', [], [], 0, 'Smoother offtake, but less forward visibility per order.'],
    ['Alloy supplier offered a volume rebate on annual commitment', 'Supplier notice', 'Price', [], [], -2.6, 'Worth evaluating against the cost of holding more stock.'],
    ['Appliance sector inventory correction appears complete', 'Industry news', 'Demand', [], ['430'], 3.4, 'The 430 decline may be close to finding a floor.'],
  ]

  const out: MarketSignal[] = defs.map((d, i) => ({
    ...d, id: `SIG-${String(i + 1).padStart(3, '0')}`,
    date: weekDates[d.week].toISOString(), read: d.week < TODAY_WEEK - 4,
  }))

  fillers.forEach(([title, sourceType, kind, regions, grades, effectPct, explanation], i) => {
    const week = rng.int(TODAY_WEEK - 26, TODAY_WEEK - 1)
    out.push({
      id: `SIG-${String(defs.length + i + 1).padStart(3, '0')}`,
      week, date: weekDates[week].toISOString(),
      title, sourceType, kind, regions, grades,
      materialIds: [],
      effectPct,
      confidence: +rng.range(0.55, 0.9).toFixed(2),
      // A signal with a real effect is worth more attention than a flat one.
      severity: Math.abs(effectPct) >= 6 ? 'Medium' : 'Low',
      explanation, read: rng.chance(0.7),
    })
  })

  return out.sort((a, b) => b.week - a.week)
}

function buildCommodity(rng: Rng): CommodityPoint[] {
  const out: CommodityPoint[] = []
  let nickel = 100, moly = 100, fc = 100
  for (let w = 0; w < HISTORY_WEEKS + HORIZON_WEEKS; w++) {
    nickel *= 1 + rng.normal(0.0012, 0.018)
    moly *= 1 + rng.normal(0.0016, 0.021)
    fc *= 1 + rng.normal(-0.0006, 0.013)
    // molybdenum climbs harder over the last six weeks — matches the signal
    if (w >= TODAY_WEEK - 6 && w <= TODAY_WEEK) moly *= 1.014
    out.push({ week: w, nickel: +nickel.toFixed(1), moly: +moly.toFixed(1), ferrochrome: +fc.toFixed(1) })
  }
  return out
}

function buildPlanHistory(rng: Rng, weekDates: Date[]): PlanHistoryEntry[] {
  const seed: Array<[PlanHistoryEntry['type'], string, string, string, string, number, boolean]> = [
    ['Setting changed', 'Service level target raised from 95% to 97% for A-class materials', 'Two near-misses last quarter on critical alloys. Higher target buys a larger buffer where it matters.', 'R. Iyer', 'Planning Manager', -412000, false],
    ['Purchase approved', 'Nickel cathode — 6 t from Supplier B', 'Covers the 304 and 316L build plan through to week 112.', 'A. Rao', 'Procurement', 10080000, false],
    ['Forecast override', 'South 316L sheet raised 12% for weeks 105–110', 'Customer confirmed a programme change in writing; the model had not yet seen enough weeks.', 'M. Shetty', 'Demand Planner', 0, false],
    ['Plan committed', 'Reduced ferrochrome (high carbon) cover from 12 to 8 weeks', 'Grade 430 volumes are falling. Holding twelve weeks of chrome against falling demand locks up cash for no service benefit.', 'R. Iyer', 'Planning Manager', 2840000, false],
    ['Anomaly action', 'Accepted the North 304 spike as a one-off', 'Single tender order, not repeatable. Leaving the baseline forecast unchanged.', 'M. Shetty', 'Demand Planner', 0, false],
    ['Plan committed', 'Moved graphite electrode to dual-source', 'Single importer with a 30-day lead and rising prices was an avoidable concentration.', 'A. Rao', 'Procurement', -180000, false],
    ['Plan reverted', 'Reversed the lime stock increase approved in week 92', 'Burnt lime has a 120-day shelf life. The extra cover would have expired before use.', 'R. Iyer', 'Planning Manager', 310000, true],
    ['Purchase approved', 'Hydrofluoric acid — 8,000 L from Supplier I', 'Built cover ahead of the supplier maintenance shutdown.', 'A. Rao', 'Procurement', 768000, false],
    ['Setting changed', 'Anomaly sensitivity tightened from 3.0 to 2.5', 'We were catching demand shifts about two weeks later than we should have.', 'M. Shetty', 'Demand Planner', 0, false],
    ['Forecast override', 'North 430 sheet cut 15% for weeks 104–116', 'Two appliance customers confirmed a move to coated carbon steel on entry models.', 'M. Shetty', 'Demand Planner', 0, false],
    ['Purchase approved', 'Rolling oil — 4,000 L from Supplier H', 'Routine replenishment against the cold mill plan.', 'S. Nair', 'Procurement', 740000, false],
    ['Plan committed', 'Transferred 180 t of 304 cold-rolled from West to North', 'North was short while West held eleven weeks of cover. A transfer beat a new production slot.', 'R. Iyer', 'Planning Manager', 1240000, false],
    ['Anomaly action', 'Accepted the East 201 step-up as a new trend', 'Rolling-stock tender award confirmed; baseline raised from week 98.', 'M. Shetty', 'Demand Planner', 0, false],
    ['Setting changed', 'Lead-time buffer for imported alloys raised from 3 to 7 days', 'Port congestion made the published lead time unreliable.', 'R. Iyer', 'Planning Manager', -560000, false],
    ['Purchase approved', 'Refractory brick — 600 nos from Supplier J', 'Relining campaign scheduled for week 110.', 'S. Nair', 'Procurement', 1710000, false],
    ['Plan committed', 'Approved ferroniobium as a substitute for ferrotitanium at 0.8:1', 'Gives the 430 stabiliser a second route if titanium tightens.', 'R. Iyer', 'Planning Manager', 0, false],
    ['Forecast override', 'West 316L coil raised 8% for weeks 106–112', 'Second region showing pharmaceutical strength; smaller than the South but real.', 'M. Shetty', 'Demand Planner', 0, false],
    ['Purchase approved', 'Steel strapping — 8,000 kg from Supplier M', 'Consolidated two depots into one order for a better rate.', 'S. Nair', 'Procurement', 864000, false],
    ['Anomaly action', 'Investigating the West 304 dip in week 97', 'Looks like a despatch timing effect rather than a demand loss.', 'M. Shetty', 'Demand Planner', 0, false],
    ['Plan committed', 'Cut wooden skid order quantity, raised order frequency', 'Supplier is unreliable in monsoon. Smaller, more frequent orders reduce the exposure.', 'A. Rao', 'Procurement', 190000, false],
    ['Setting changed', 'Forecast horizon extended from 12 to 26 weeks', 'Imported alloys need visibility beyond their own lead time to be planned properly.', 'R. Iyer', 'Planning Manager', 0, false],
  ]
  return seed.map((s, i) => {
    const week = TODAY_WEEK - 1 - Math.floor(i * 1.15)
    return {
      id: `PH-${String(1000 + seed.length - i)}`,
      week, at: weekDates[Math.max(0, week)].toISOString(),
      type: s[0], title: s[1], reason: s[2], user: s[3], role: s[4],
      impactINR: s[5], reverted: s[6],
    }
  })
}

// =============================================================================
// Put it all together
// =============================================================================
let cached: Dataset | null = null

export function buildDataset(seed = 20260413): Dataset {
  const rng = new Rng(seed)
  const startDate = addWeeks(DEMO_TODAY, -HISTORY_WEEKS)
  // Far enough forward that a plan made from the last week the calendar allows
  // still has a real date for every week of its horizon.
  const weekDates = Array.from(
    { length: HISTORY_WEEKS + FUTURE_WEEKS + HORIZON_WEEKS + 2 },
    (_, i) => addWeeks(startDate, i),
  )

  const skus = buildSkus(rng)
  const { demand } = buildDemand(rng, skus)
  const bom = buildBom(skus)
  // Cost and price come from the recipe, not from a separate table that could
  // drift away from it. Deterministic, so it consumes none of the rng stream
  // and leaves every tuned number in the story where it was.
  repriceFromRecipe(skus, bom)
  const materials = buildMaterials(rng, skus, demand, bom)
  const suppliers = buildSuppliers(rng, materials)
  const customers = buildCustomers(rng)
  const orders = buildOrders(rng, skus, customers, demand)
  const purchaseOrders = buildPurchaseOrders(rng, materials, suppliers)
  const signals = buildSignals(rng, weekDates)
  const commodity = buildCommodity(rng)
  const planHistory = buildPlanHistory(rng, weekDates)

  return {
    todayWeek: TODAY_WEEK, startDate, weekDates,
    regions: REGIONS, warehouses: WAREHOUSES, plants: PLANTS, lines: LINES,
    skus, materials, suppliers, customers, orders, purchaseOrders,
    signals, commodity, bom, demand, planHistory,
  }
}

export function getDataset(): Dataset {
  if (!cached) cached = buildDataset()
  return cached
}

/** Helper used across the app: date for a week index. */
export function weekDate(ds: Dataset, week: number): Date {
  return ds.weekDates[clamp(week, 0, ds.weekDates.length - 1)]
}
