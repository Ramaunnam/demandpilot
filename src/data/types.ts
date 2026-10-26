/** Every shape of data used in DemandPilot. One industry, one data set. */

export type Grade = '304' | '316L' | '430' | '201'
export type Form = 'Cold-rolled coil' | 'Hot-rolled coil' | 'Sheet'
export type Finish = '2B' | 'BA' | 'No.1' | 'No.4' | 'HL'
export type RegionName = 'North' | 'South' | 'East' | 'West'
export type Lifecycle = 'New' | 'Growing' | 'Mature' | 'Declining'
export type ABC = 'A' | 'B' | 'C'
export type XYZ = 'X' | 'Y' | 'Z'

export interface Region {
  id: RegionName
  name: RegionName
  warehouses: string[]
  hubCity: string
  industries: string[]
  share: number
}

export interface Warehouse {
  id: string
  name: string
  region: RegionName
  type: 'Plant warehouse' | 'Distribution warehouse'
  capacityT: number
}

export interface Plant {
  id: string
  name: string
  region: RegionName
  lines: string[]
  commissioned: number
}

export interface ProductionLine {
  id: string
  name: string
  plantId: string
  process: 'Melting & casting' | 'Hot rolling' | 'Cold rolling' | 'Annealing & pickling' | 'Finishing & slitting'
  weeklyCapacityT: number
  shifts: number
  maintenanceWeeks: number[]
  forms: Form[]
}

export interface Sku {
  id: string
  code: string
  name: string
  grade: Grade
  form: Form
  thicknessMm: number
  widthMm: number
  finish: Finish
  unit: 't'
  pricePerT: number
  costPerT: number
  marginPct: number
  abc: ABC
  xyz: XYZ
  lifecycle: Lifecycle
  historyStartWeek: number
  lumpy: boolean
  mainRegions: RegionName[]
  mainIndustries: string[]
  handlingNote: string
  lineIds: string[]
}

export type MaterialCategory =
  | 'Alloy' | 'Base metal' | 'Flux' | 'Industrial gas'
  | 'Process chemical' | 'Consumable' | 'Packaging' | 'Spare part'

export interface Material {
  id: string
  code: string
  name: string
  category: MaterialCategory
  unit: 'kg' | 't' | 'L' | 'nos' | 'm³'
  costPerUnit: number
  abc: ABC
  critical: boolean
  shelfLifeDays: number | null
  storage: string
  moq: number
  lotRule: 'Lot-for-lot' | 'Fixed lot' | 'Min order qty'
  lotSize: number
  leadTimeDays: number
  leadTimeSdDays: number
  primarySupplierId: string
  backupSupplierIds: string[]
  substituteIds: string[]
  priceTrendPct: number
  onHandByWh: Record<string, number>
  onOrder: number
  staticMinLevel: number
  usedByGrades: Grade[]
  notes: string
}

export interface Supplier {
  id: string
  name: string
  city: string
  region: RegionName | 'Import'
  materialIds: string[]
  leadTimeDays: number
  leadTimeSdDays: number
  otifPct: number
  qualityPct: number
  priceVariancePct: number
  paymentTerms: string
  monthlyCapacity: number
  risk: 'Low' | 'Medium' | 'High'
  certifications: string[]
  contactRole: string
  lastReview: string
  scoreTrend: number[]
}

export interface Customer {
  id: string
  name: string
  industry: string
  region: RegionName
  since: number
  creditDays: number
  annualTonnage: number
  deliveryPerfPct: number
}

export type OrderStatus = 'Open' | 'Confirmed' | 'In production' | 'Dispatched' | 'Delivered'

export interface CustomerOrder {
  id: string
  customerId: string
  skuId: string
  region: RegionName
  qtyT: number
  pricePerT: number
  valueINR: number
  orderWeek: number
  promisedWeek: number
  status: OrderStatus
  priority: 'High' | 'Normal' | 'Low'
  onTime: boolean | null
}

export type POStatus =
  | 'Recommended' | 'Approved' | 'Sent' | 'Confirmed' | 'In transit' | 'Received' | 'Cancelled'

export interface PurchaseOrder {
  id: string
  supplierId: string
  materialId: string
  qty: number
  pricePerUnit: number
  valueINR: number
  orderWeek: number
  promisedWeek: number
  expectedWeek: number
  neededWeek: number
  status: POStatus
  receivedPct: number
  payment: 'Pending' | 'Partial' | 'Paid'
  linkedRecommendationId: string | null
  raisedBy: string
  note: string
}

export type SignalSourceType =
  | 'Industry news' | 'Commodity index' | 'Customer intimation'
  | 'Supplier notice' | 'Logistics update' | 'Policy update'

export interface MarketSignal {
  id: string
  week: number
  date: string
  title: string
  sourceType: SignalSourceType
  kind: 'Demand' | 'Supply' | 'Price' | 'Logistics'
  regions: RegionName[]
  grades: Grade[]
  materialIds: string[]
  effectPct: number
  confidence: number
  severity: 'Low' | 'Medium' | 'High'
  explanation: string
  read: boolean
}

export interface CommodityPoint { week: number; nickel: number; moly: number; ferrochrome: number }

export interface BomLine { materialId: string; qtyPerTonne: number; scrapPct: number }

export interface DemandSeries {
  skuId: string
  region: RegionName
  /** 104 weeks of actual sales in tonnes, oldest first. */
  weeks: number[]
}

export interface PlanHistoryEntry {
  id: string
  week: number
  at: string
  type: 'Plan committed' | 'Purchase approved' | 'Forecast override' | 'Setting changed' | 'Anomaly action' | 'Plan reverted'
  title: string
  reason: string
  user: string
  role: string
  impactINR: number
  reverted: boolean
  payload?: Record<string, unknown>
}

export interface Dataset {
  todayWeek: number
  startDate: Date
  weekDates: Date[]
  regions: Region[]
  warehouses: Warehouse[]
  plants: Plant[]
  lines: ProductionLine[]
  skus: Sku[]
  materials: Material[]
  suppliers: Supplier[]
  customers: Customer[]
  orders: CustomerOrder[]
  purchaseOrders: PurchaseOrder[]
  signals: MarketSignal[]
  commodity: CommodityPoint[]
  bom: Record<string, BomLine[]>
  demand: DemandSeries[]
  planHistory: PlanHistoryEntry[]
}
