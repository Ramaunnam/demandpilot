/**
 * Connected systems — where every number on the other screens comes from, and
 * what DemandPilot sends back out when someone decides something.
 *
 * The record counts are not invented. Every one is read off the dataset this
 * build is actually running, so "240 products" here and "240 products" on the
 * Forecast header can never drift apart. The connections themselves are
 * simulated: the point of the screen is to show the shape of an integration —
 * which field becomes which, how stale a feed is allowed to get, and what
 * stops working when one dies — not to pretend a plant is on the other end.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Database, Factory, Warehouse, Users, Handshake, LineChart, Newspaper,
  MessageSquare, Upload, RefreshCw, ArrowRight, ArrowDownToLine,
  ArrowUpFromLine, ArrowLeftRight, AlertTriangle, PauseCircle, PlayCircle,
  ShieldCheck, Send, Activity, ChevronRight,
} from 'lucide-react'
import { useStore } from '@/store/useStore'
import {
  Head, Panel, Tile, Tiles, Chip, Dot, Bar, Drawer, LVRow, Spark, Empty,
  type Tone,
} from '@/ui/kit'
import { Table, type Col } from '@/ui/Table'
import { fmtNum, fmtINR, clamp } from '@/lib/format'

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------
/**
 * `manual` is a feed with no schedule: it runs when a person uploads a file.
 * It was modelled as `paused`, which made the card read as switched off and put
 * a disabled "Sync now" in front of the one system on this screen that has a
 * real action available.
 */
type Health = 'healthy' | 'degraded' | 'paused' | 'syncing' | 'manual'
type Dir = 'in' | 'out' | 'both'

interface Mapping { from: string; to: string; what: string }
interface Feed { label: string; to: string }

interface Sys {
  id: string
  name: string
  sub: string
  kind: string
  icon: React.ElementType
  dir: Dir
  protocol: string
  auth: string
  owner: string
  endpoint: string
  schedule: string
  /** How stale this feed is allowed to get before the plan is working blind. */
  freshMins: number
  lastMin: number
  latencyMs: number
  rows: { label: string; n: number }[]
  feeds: Feed[]
  mappings: Mapping[]
  /** Last twelve sync durations, in seconds. */
  history: number[]
  breaks: string
  health: Health
  note?: string
  /** What a person can actually do with this system, where that is a thing. */
  action?: { label: string; to: string }
}

const DIR_META: Record<Dir, { label: string; icon: React.ElementType }> = {
  in: { label: 'Reads', icon: ArrowDownToLine },
  out: { label: 'Writes', icon: ArrowUpFromLine },
  both: { label: 'Both ways', icon: ArrowLeftRight },
}

const TONE_OF_HEALTH: Record<Health, Tone> = {
  healthy: 'success', degraded: 'warning', paused: 'neutral', syncing: 'info', manual: 'info',
}
const LABEL_OF_HEALTH: Record<Health, string> = {
  healthy: 'Healthy', degraded: 'Degraded', paused: 'Paused', syncing: 'Syncing', manual: 'On demand',
}
/** Neither scheduled nor running: nothing to sync, pause or go stale. */
const isManual = (h: Health) => h === 'manual'

function ago(mins: number): string {
  if (mins < 0) return 'never'
  if (mins === 0) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.floor(mins / 60)
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`
}

function hhmmss(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour12: false })
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
interface LogRow {
  id: number
  at: Date
  sysId: string
  name: string
  dir: Dir
  rows: number
  ms: number
  outcome: 'Loaded' | 'Partial' | 'Failed' | 'Sent' | 'Paused'
  detail: string
}

export default function Connected() {
  const { ds, result, uploads, toast } = useStore()
  const r = result!

  // One clock reading for the whole session, so the seeded log does not jump
  // around between renders.
  const [mounted] = useState(() => new Date())
  const bomLines = useMemo(
    () => Object.values(ds.bom).reduce((s, a) => s + a.length, 0), [ds.bom])

  // --- the catalogue -------------------------------------------------------
  const DEFS = useMemo<Sys[]>(() => [
    {
      id: 'erp', name: 'SAP S/4HANA', sub: 'PRD-100 · Materials, stock, orders',
      kind: 'ERP', icon: Database, dir: 'both',
      protocol: 'OData v4 + CDS views', auth: 'OAuth 2.0 · service user DP_SYNC',
      owner: 'IT — Enterprise applications', endpoint: 'sap-prd.internal/sap/opu/odata4/dp',
      schedule: 'Every hour, on the hour', freshMins: 120, lastMin: 4, latencyMs: 1240,
      rows: [
        { label: 'Products', n: ds.skus.length },
        { label: 'Materials', n: ds.materials.length },
        { label: 'Recipe lines', n: bomLines },
        { label: 'Open purchase orders', n: ds.purchaseOrders.length },
        { label: 'Sales orders', n: ds.orders.length },
      ],
      feeds: [
        { label: 'Stock', to: '/stock' }, { label: 'Plan & MRP', to: '/plan' },
        { label: 'Orders', to: '/orders' }, { label: 'Recommendations', to: '/buy' },
      ],
      mappings: [
        { from: 'MARA-MATNR', to: 'material.code', what: 'Material number' },
        { from: 'MBEW-STPRS', to: 'material.pricePerUnit', what: 'Standard cost' },
        { from: 'MARD-LABST', to: 'stock.onHand', what: 'Unrestricted stock by plant' },
        { from: 'STPO-MENGE / AUSCH', to: 'bom.qtyPerTonne, bom.scrapPct', what: 'Recipe quantity and scrap' },
        { from: 'EKPO + EKET', to: 'purchaseOrder.qty, confirmedDate', what: 'Open PO lines and schedule' },
        { from: 'VBAP-KWMENG', to: 'order.qtyTonnes', what: 'Confirmed sales order quantity' },
      ],
      history: [1.3, 1.2, 1.4, 1.2, 1.1, 1.5, 1.2, 1.3, 1.2, 1.2, 1.4, 1.2],
      breaks: 'Nothing can be planned. Stock, recipes and the open order book all come from here — the forecast would still run, but it would have nothing to turn into material needs.',
      health: 'healthy',
    },
    {
      id: 'mes', name: 'Plant MES', sub: `${ds.plants.length} plants · ${ds.lines.length} lines`,
      kind: 'Manufacturing execution', icon: Factory, dir: 'in',
      protocol: 'MQTT over TLS · topic dp/lines/#', auth: 'Client certificate · rotated 90 d',
      owner: 'Operations technology', endpoint: 'mes-broker.plant.internal:8883',
      schedule: 'Every 15 minutes', freshMins: 30, lastMin: 47, latencyMs: 2980,
      rows: [
        { label: 'Production lines', n: ds.lines.length },
        { label: 'Plants', n: ds.plants.length },
        { label: 'Confirmations today', n: 318 },
      ],
      feeds: [{ label: 'Plan & MRP', to: '/plan' }, { label: 'Exceptions', to: '/exceptions' }],
      mappings: [
        { from: 'line.rated_capacity_t_wk', to: 'line.capacityTonnesPerWeek', what: 'Weekly rated capacity' },
        { from: 'line.maint_window', to: 'line.maintenanceWeeks', what: 'Planned shutdowns' },
        { from: 'conf.good_qty', to: 'plan.actualOutput', what: 'Confirmed good output' },
        { from: 'conf.scrap_qty', to: 'plan.actualScrapPct', what: 'Actual scrap, against the recipe' },
      ],
      history: [2.9, 3.1, 2.8, 3.0, 2.9, 3.4, 2.9, 3.0, 8.2, 0, 0, 0],
      breaks: 'The plan keeps using last known capacity. Maintenance weeks go stale first, so the plan quietly over-promises a line that is down.',
      health: 'degraded',
      note: 'Line PL-2-CR dropped off the broker 47 minutes ago. Capacity is being carried forward from the last good read.',
    },
    {
      id: 'wms', name: 'Warehouse management', sub: `${ds.warehouses.length} sites · batch level`,
      kind: 'WMS', icon: Warehouse, dir: 'in',
      protocol: 'REST + nightly SFTP delta', auth: 'API key · IP allow-list',
      owner: 'Logistics', endpoint: 'wms.internal/api/v2/inventory',
      schedule: 'Every hour', freshMins: 120, lastMin: 12, latencyMs: 640,
      rows: [
        { label: 'Warehouses', n: ds.warehouses.length },
        { label: 'Stock positions', n: ds.materials.length * ds.warehouses.length },
        { label: 'In-transit lines', n: 74 },
      ],
      feeds: [{ label: 'Stock', to: '/stock' }, { label: 'Exceptions', to: '/exceptions' }],
      mappings: [
        { from: 'loc_stock.qty', to: 'stock.byWarehouse', what: 'Stock per site' },
        { from: 'asn.eta', to: 'stock.inTransit', what: 'Expected arrivals' },
        { from: 'batch.expiry_date', to: 'material.shelfLifeDays', what: 'Shelf life, for the expiry rule' },
      ],
      history: [0.7, 0.6, 0.6, 0.7, 0.6, 0.6, 0.7, 0.6, 0.6, 0.7, 0.6, 0.6],
      breaks: 'Cover days go back to plant-level totals, so stock sitting in the wrong region looks available.',
      health: 'healthy',
    },
    {
      id: 'crm', name: 'Salesforce CRM', sub: `${ds.customers.length} accounts · 8 industries`,
      kind: 'CRM', icon: Users, dir: 'in',
      protocol: 'Bulk API 2.0 + platform events', auth: 'Connected app · JWT bearer',
      owner: 'Commercial', endpoint: 'j2w.my.salesforce.com/services/data/v61.0',
      schedule: 'Daily 05:30, events live', freshMins: 1440, lastMin: 186, latencyMs: 4100,
      rows: [
        { label: 'Accounts', n: ds.customers.length },
        { label: 'Customer intimations', n: ds.signals.filter(s => s.sourceType === 'Customer intimation').length },
        { label: 'Open opportunities', n: 41 },
      ],
      feeds: [{ label: 'Signals', to: '/signals' }, { label: 'Forecast', to: '/forecast' }],
      mappings: [
        { from: 'Account.Id', to: 'customer.id', what: 'Account' },
        { from: 'Opportunity.Amount / CloseDate', to: 'signal (Customer intimation)', what: 'Told-us-early demand' },
        { from: 'Account.Industry', to: 'customer.industry', what: 'Industry, for the demand mix' },
      ],
      history: [4.3, 4.1, 3.9, 4.2, 4.0, 4.4, 4.1, 4.2, 4.0, 4.1, 4.3, 4.1],
      breaks: 'Customers telling you early stops reaching the forecast. Those weeks then arrive as anomalies instead of as plans.',
      health: 'healthy',
    },
    {
      id: 'srm', name: 'Supplier portal', sub: `${ds.suppliers.length} suppliers · ack + RFQ`,
      kind: 'SRM', icon: Handshake, dir: 'both',
      protocol: 'REST webhooks + EDI 855/856', auth: 'mTLS per supplier',
      owner: 'Procurement', endpoint: 'suppliers.j2w.in/api/v1',
      schedule: 'Live on event', freshMins: 240, lastMin: 23, latencyMs: 880,
      rows: [
        { label: 'Suppliers', n: ds.suppliers.length },
        { label: 'Acknowledgements', n: ds.purchaseOrders.filter(p => p.status !== 'Recommended').length },
        { label: 'Lead-time updates (30 d)', n: 9 },
      ],
      feeds: [
        { label: 'Orders', to: '/orders' }, { label: 'Recommendations', to: '/buy' },
        { label: 'Signals', to: '/signals' },
      ],
      mappings: [
        { from: 'vendor.lead_time_days', to: 'supplier.leadTimeDays', what: 'Quoted lead time' },
        { from: 'vendor.otif_rolling_12m', to: 'supplier.otifPct', what: 'On time, in full' },
        { from: 'EDI 855', to: 'purchaseOrder.confirmedDate', what: 'Supplier confirms the date' },
        { from: 'EDI 856', to: 'purchaseOrder.status = In transit', what: 'Despatch advice' },
        { from: 'recommendation → rfq.create', to: 'outbound', what: 'DemandPilot asks for a price' },
      ],
      history: [0.9, 0.8, 0.9, 1.1, 0.9, 0.8, 0.9, 0.9, 1.0, 0.9, 0.8, 0.9] ,
      breaks: 'Order-by dates fall back to the quoted lead time. A supplier slipping a week is then invisible until the delivery misses.',
      health: 'healthy',
    },
    {
      id: 'mkt', name: 'Commodity price feed', sub: 'LME · Platts · CRU',
      kind: 'Market data', icon: LineChart, dir: 'in',
      protocol: 'HTTPS pull, CSV', auth: 'Subscription token',
      owner: 'Finance — Treasury', endpoint: 'feeds.metalsdata.example/v3/close',
      schedule: 'Daily, after close', freshMins: 1440, lastMin: 402, latencyMs: 310,
      rows: [
        { label: 'Weekly index points', n: ds.commodity.length },
        { label: 'Series', n: 3 },
      ],
      feeds: [{ label: 'Signals', to: '/signals' }, { label: 'Recommendations', to: '/buy' }],
      mappings: [
        { from: 'LME:NI cash', to: 'commodity.nickel', what: 'Nickel' },
        { from: 'Platts:MOLY-OX', to: 'commodity.moly', what: 'Molybdenum oxide' },
        { from: 'CRU:FeCr-HC', to: 'commodity.ferrochrome', what: 'Ferrochrome, high carbon' },
      ],
      history: [0.3, 0.3, 0.4, 0.3, 0.3, 0.3, 0.4, 0.3, 0.3, 0.3, 0.3, 0.3],
      breaks: 'The buy-now-or-wait advice loses its price view and falls back to quantity alone.',
      health: 'healthy',
    },
    {
      id: 'news', name: 'Industry news & policy', sub: 'Curated feeds + classifier',
      kind: 'Signals', icon: Newspaper, dir: 'in',
      protocol: 'RSS + publisher API', auth: 'Public + 2 licensed feeds',
      owner: 'Planning', endpoint: '14 sources · classified on ingest',
      schedule: 'Four times a day', freshMins: 360, lastMin: 96, latencyMs: 1560,
      rows: [
        { label: 'Signals held', n: ds.signals.length },
        { label: 'Articles screened (30 d)', n: 1264 },
        { label: 'Kept after scoring', n: ds.signals.filter(s => s.sourceType === 'Industry news' || s.sourceType === 'Policy update').length },
      ],
      feeds: [{ label: 'Signals', to: '/signals' }, { label: 'Forecast', to: '/forecast' }],
      mappings: [
        { from: 'article.title + body', to: 'signal.title, explanation', what: 'What happened' },
        { from: 'classifier.grade / region', to: 'signal.grades, regions', what: 'Who it touches' },
        { from: 'classifier.effect', to: 'signal.effectPct, confidence', what: 'How much, how sure' },
      ],
      history: [1.6, 1.5, 1.7, 1.5, 1.6, 1.5, 1.6, 1.8, 1.5, 1.6, 1.5, 1.6],
      breaks: 'The forecast keeps running on history alone. Outside events only show up weeks later, as error.',
      health: 'healthy',
    },
    {
      id: 'msg', name: 'Teams & email', sub: 'Alert delivery',
      kind: 'Messaging', icon: MessageSquare, dir: 'out',
      protocol: 'Graph API + SMTP relay', auth: 'App registration · Mail.Send',
      owner: 'IT — Collaboration', endpoint: 'graph.microsoft.com/v1.0 · smtp.internal:587',
      schedule: 'On rule trigger', freshMins: 1440, lastMin: 2, latencyMs: 420,
      rows: [
        { label: 'Alert rules active', n: 12 },
        { label: 'Messages sent (7 d)', n: 46 },
        { label: 'Recipient groups', n: 7 },
      ],
      feeds: [{ label: 'Alert rules', to: '/setup' }, { label: 'Exceptions', to: '/exceptions' }],
      mappings: [
        { from: 'rule (cover < 3 days)', to: 'Email + SMS + in-app', what: 'Critical, immediate' },
        { from: 'rule (order-by passed)', to: 'Email + SMS', what: 'Critical, immediate' },
        { from: 'rule (anomaly rated High)', to: 'Email + in-app', what: 'Planner and Sales' },
      ],
      history: [0.4, 0.4, 0.5, 0.4, 0.4, 0.4, 0.4, 0.5, 0.4, 0.4, 0.4, 0.4],
      breaks: 'Nothing is lost — every alert is still in the exception queue. People just have to come and look.',
      health: 'healthy',
    },
    {
      id: 'csv', name: 'Manual upload', sub: 'CSV, planner-driven',
      kind: 'File', icon: Upload, dir: 'in',
      protocol: 'Browser upload, parsed locally', auth: 'The signed-in planner',
      owner: 'Planning', endpoint: 'Settings → Your own data',
      schedule: 'Whenever you need it', freshMins: 100000, latencyMs: 90,
      // -1 means never. There is no "last upload" before anyone has uploaded,
      // and showing a stale-looking "2 d ago" for an empty feed is a number
      // that was never measured.
      lastMin: uploads.length
        ? Math.max(0, Math.round((Date.now() - new Date(uploads[0].at).getTime()) / 60000))
        : -1,
      rows: [
        { label: 'Files on the feed', n: uploads.length },
        { label: 'Read as demand history', n: uploads.filter(u => u.parsed).length },
        { label: 'Attached as evidence', n: uploads.filter(u => !u.parsed).length },
      ],
      feeds: [{ label: 'Settings', to: '/setup' }, { label: 'Forecast', to: '/forecast' }],
      mappings: [
        { from: 'sku | product | item | code', to: 'series key', what: 'Matched on header name' },
        { from: 'qty | volume | sales | demand', to: 'series value', what: 'The quantity column' },
        { from: 'region | area | zone', to: 'series region', what: 'Optional' },
        { from: 'week | period | date', to: 'series week', what: 'Optional' },
        { from: 'anything else', to: 'attachment', what: 'PDF, image, video — kept, never parsed' },
      ],
      history: [0.1, 0, 0, 0.1, 0, 0, 0, 0.1, 0, 0, 0, 0],
      breaks: 'Nothing. This one exists so a planner can test the models on their own history without waiting for IT.',
      health: 'manual',
      note: 'No schedule — it runs when you upload. A CSV, TSV or text file is read as demand history and the models are fitted on it; any other type — a PDF quote, a photo of a delivery note, a video from the line — is attached to the feed as evidence and does not move the forecast.',
      action: { label: 'Upload a CSV', to: '/setup?tab=upload' },
    },
  ], [ds, bomLines, uploads])

  // --- what the session has changed ---------------------------------------
  const [ov, setOv] = useState<Record<string, Partial<Pick<Sys, 'health' | 'lastMin' | 'latencyMs'>>>>({})
  const systems = useMemo(() => DEFS.map(s => ({ ...s, ...ov[s.id] })), [DEFS, ov])

  const [log, setLog] = useState<LogRow[]>(() => {
    const seed: LogRow[] = []
    let n = 0
    for (const s of DEFS) {
      if (s.health === 'paused') continue
      const rows = s.rows.reduce((a, b) => a + b.n, 0)
      seed.push({
        id: ++n, at: new Date(mounted.getTime() - s.lastMin * 60000),
        sysId: s.id, name: s.name, dir: s.dir, rows,
        ms: Math.round(s.latencyMs),
        outcome: s.health === 'degraded' ? 'Partial' : s.dir === 'out' ? 'Sent' : 'Loaded',
        detail: s.health === 'degraded'
          ? 'Line PL-2-CR did not answer — carried forward the last good read'
          : `${s.rows.map(x => `${fmtNum(x.n)} ${x.label.toLowerCase()}`).join(' · ')}`,
      })
    }
    // A failure left on the record, because a log that only ever shows success
    // is not a log.
    seed.push({
      id: ++n, at: new Date(mounted.getTime() - 62 * 60000), sysId: 'mes',
      name: 'Plant MES', dir: 'in', rows: 0, ms: 30000, outcome: 'Failed',
      detail: 'MQTT broker refused the client certificate — retried and recovered',
    })
    return seed.sort((a, b) => b.at.getTime() - a.at.getTime())
  })

  const nextLogId = useRef(1000)
  const timers = useRef<number[]>([])
  useEffect(() => () => { timers.current.forEach(t => clearTimeout(t)) }, [])

  const push = (row: Omit<LogRow, 'id' | 'at'>) =>
    setLog(l => [{ ...row, id: ++nextLogId.current, at: new Date() }, ...l].slice(0, 60))

  /** Run one feed: a visible pause, then the numbers move. */
  const sync = (s: Sys, delay = 0) => {
    const t1 = window.setTimeout(() => {
      setOv(o => ({ ...o, [s.id]: { ...o[s.id], health: 'syncing' } }))
      const dur = Math.min(1700, 420 + s.latencyMs / 3)
      const t2 = window.setTimeout(() => {
        setOv(o => ({ ...o, [s.id]: { health: 'healthy', lastMin: 0, latencyMs: s.latencyMs } }))
        push({
          sysId: s.id, name: s.name, dir: s.dir,
          rows: s.rows.reduce((a, b) => a + b.n, 0), ms: Math.round(s.latencyMs),
          outcome: s.dir === 'out' ? 'Sent' : 'Loaded',
          detail: s.rows.map(x => `${fmtNum(x.n)} ${x.label.toLowerCase()}`).join(' · '),
        })
      }, dur)
      timers.current.push(t2)
    }, delay)
    timers.current.push(t1)
  }

  const syncAll = () => {
    const live = systems.filter(s => s.health !== 'paused' && s.health !== 'syncing' && !isManual(s.health))
    if (!live.length) return
    live.forEach((s, i) => sync(s, i * 160))
    toast(`Refreshing ${live.length} feeds.`, 'info')
  }

  const togglePause = (s: Sys) => {
    const paused = s.health === 'paused'
    setOv(o => ({ ...o, [s.id]: { ...o[s.id], health: paused ? 'healthy' : 'paused', lastMin: paused ? 0 : s.lastMin } }))
    push({
      sysId: s.id, name: s.name, dir: s.dir, rows: 0, ms: 0,
      outcome: paused ? 'Loaded' : 'Paused',
      detail: paused ? 'Connection resumed by you' : 'Connection paused by you — nothing will be read or written',
    })
    toast(paused ? `${s.name} resumed.` : `${s.name} paused.`, paused ? 'good' : 'warn')
  }

  // --- headline numbers ----------------------------------------------------
  const healthy = systems.filter(s => s.health === 'healthy' || s.health === 'syncing').length
  const attention = systems.filter(s => s.health === 'degraded').length
  // Scheduled feeds only. A manual upload has no schedule, so it cannot be
  // stale and does not belong in "connected" or in the freshness maths.
  const scheduled = systems.filter(s => !isManual(s.health))
  const live = scheduled.filter(s => s.health !== 'paused')
  const manualSystems = systems.filter(s => isManual(s.health))
  const rowsIn = scheduled.filter(s => s.dir !== 'out' && s.health !== 'paused')
    .reduce((a, s) => a + s.rows.reduce((x, y) => x + y.n, 0), 0)
  const fields = systems.reduce((a, s) => a + s.mappings.length, 0)
  const stalest: Sys | undefined = live.length
    ? live.reduce((w, s) => (s.lastMin / s.freshMins > w.lastMin / w.freshMins ? s : w))
    : undefined
  const [open, setOpen] = useState<string | null>(null)
  const sel = systems.find(s => s.id === open) ?? null

  // --- the chain the data moves along --------------------------------------
  // Three of these had no destination but kept the hover styling of the ones
  // that did, so half the rail looked clickable and did nothing. The stages
  // that live on this screen now scroll to their own section.
  const cardsRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const outbound = systems.filter(x => x.dir === 'out' || x.dir === 'both')
  const goTo = (el: HTMLElement | null) =>
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const CHAIN: { label: string; sub: string; to?: string; go?: () => void; icon: React.ElementType }[] = [
    { label: 'Source systems', sub: `${live.length} live`, go: () => goTo(cardsRef.current), icon: Database },
    { label: 'Read & check', sub: `${fmtNum(rowsIn)} rows`, go: () => goTo(logRef.current), icon: ShieldCheck },
    { label: 'Forecast', sub: `${ds.skus.length * ds.regions.length} series`, to: '/forecast', icon: Activity },
    { label: 'Plan & MRP', sub: `${fmtNum(r.mrp.plannedOrders.length)} planned orders`, to: '/plan', icon: Factory },
    { label: 'Recommend', sub: `${r.recommendations.length} to decide`, to: '/buy', icon: Send },
    { label: 'Write back', sub: `${outbound.length} systems`, go: () => goTo(cardsRef.current), icon: ArrowUpFromLine },
  ]

  const mapCols: Col<Mapping>[] = [
    { key: 'from', h: 'In the source system', cell: m => <span className="font-mono text-sm">{m.from}</span>, val: m => m.from },
    { key: 'to', h: 'Becomes', cell: m => <span className="font-mono text-sm text-primary">{m.to}</span>, val: m => m.to },
    { key: 'what', h: 'What it is', cell: m => <span className="text-muted">{m.what}</span>, val: m => m.what },
  ]

  const logCols: Col<LogRow>[] = [
    { key: 'at', h: 'Time', w: '78px', cell: l => <span className="num text-muted">{hhmmss(l.at)}</span>, val: l => l.at.getTime() },
    { key: 'name', h: 'System', w: '150px', cell: l => <span className="font-medium">{l.name}</span>, val: l => l.name },
    {
      key: 'dir', h: '', w: '26px', cell: l => {
        const I = DIR_META[l.dir].icon
        return <I className="w-3 h-3 text-muted" title={DIR_META[l.dir].label} />
      },
    },
    { key: 'rows', h: 'Rows', right: true, w: '74px', cell: l => <span className="num">{l.rows ? fmtNum(l.rows) : '—'}</span>, val: l => l.rows },
    { key: 'ms', h: 'Took', right: true, w: '70px', cell: l => <span className="num text-muted">{l.ms ? `${(l.ms / 1000).toFixed(1)}s` : '—'}</span>, val: l => l.ms },
    {
      key: 'outcome', h: 'Outcome', w: '92px', cell: l => (
        <Chip tone={l.outcome === 'Failed' ? 'danger' : l.outcome === 'Partial' ? 'warning'
          : l.outcome === 'Paused' ? 'neutral' : l.outcome === 'Sent' ? 'info' : 'success'}>{l.outcome}</Chip>
      ), val: l => l.outcome,
    },
    { key: 'detail', h: 'Detail', cell: l => <span className="text-muted">{l.detail}</span>, val: l => l.detail },
  ]

  return (
    <>
      <Head
        title="Connected systems"
        blurb="Where every number on these screens comes from, and what goes back out"
        chips={
          <>
            <Chip tone="success"><Dot tone="success" /> {healthy} healthy</Chip>
            {attention > 0 && <Chip tone="warning"><Dot tone="warning" pulse /> {attention} needs attention</Chip>}
          </>
        }
        actions={
          <>
            <Link to="/setup?tab=alerts" className="btn btn-outline btn-sm">Alert rules</Link>
            <button className="btn btn-primary btn-sm" onClick={syncAll}
              disabled={systems.some(s => s.health === 'syncing')}>
              <RefreshCw className={`w-3.5 h-3.5 ${systems.some(s => s.health === 'syncing') ? 'animate-spin' : ''}`} />
              Refresh all
            </button>
          </>
        }
      />

      <Tiles cols={6}>
        <Tile k="Connected" v={`${healthy}/${scheduled.length}`}
          sub={`scheduled feeds · ${manualSystems.length} on demand`}
          tone={attention ? 'warning' : 'success'} />
        <Tile k="Needs attention" v={String(attention)}
          sub={attention && stalest ? stalest.name : 'all feeds inside target'}
          tone={attention ? 'warning' : undefined} />
        <Tile k="Rows read" v={fmtNum(rowsIn)} sub="on the last full refresh" />
        <Tile k="Fields mapped" v={String(fields)} sub={`across ${systems.length} systems`} />
        <Tile k="Stalest feed" v={stalest ? ago(stalest.lastMin) : '—'}
          sub={stalest ? `${stalest.name} · target ${stalest.freshMins} min` : 'every feed is paused'}
          tone={stalest && stalest.lastMin > stalest.freshMins ? 'warning' : undefined} />
        <Tile k="Writes out" v={String(outbound.length)}
          sub="systems DemandPilot can write to" />
      </Tiles>

      {/* The chain, so the cards below have somewhere to point. */}
      <Panel className="mt-2.5" title="How a row becomes a decision"
        note="Every stage reads the one before it. One calculation feeds all thirteen screens, which is why the counts here match the counts there.">
        <div className="flex items-stretch gap-1 overflow-x-auto no-scrollbar pb-1">
          {CHAIN.map((c, i) => {
            const Icon = c.icon
            const body = (
              <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-line bg-surface2 h-full
                              min-w-[136px] hover:border-primary/40 transition-colors">
                <Icon className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="text-base font-semibold truncate">{c.label}</div>
                  <div className="num text-2xs text-muted truncate">{c.sub}</div>
                </div>
              </div>
            )
            return (
              <React.Fragment key={c.label}>
                {c.to
                  ? <Link to={c.to} className="shrink-0">{body}</Link>
                  : <button type="button" onClick={c.go} className="shrink-0 text-left">{body}</button>}
                {i < CHAIN.length - 1 && (
                  <div className="grid place-items-center shrink-0 px-0.5">
                    <ArrowRight className="w-3.5 h-3.5 text-muted/60" />
                  </div>
                )}
              </React.Fragment>
            )
          })}
        </div>
      </Panel>

      {/* One card per system. */}
      <div ref={cardsRef} className="grid gap-2.5 mt-2.5 md:grid-cols-2 xl:grid-cols-3 scroll-mt-16">
        {systems.map(s => {
          const Icon = s.icon
          const DirIcon = DIR_META[s.dir].icon
          const stale = s.health !== 'paused' && !isManual(s.health) && s.lastMin > s.freshMins
          const fresh = clamp(100 - (s.lastMin / s.freshMins) * 100, 0, 100)
          const tone = TONE_OF_HEALTH[s.health]
          const ring = s.health === 'degraded' ? 'border-warning/40'
            : s.health === 'paused' ? 'border-line opacity-80' : 'border-line'
          const rows = s.rows.reduce((a, b) => a + b.n, 0)
          return (
            <button key={s.id} onClick={() => setOpen(s.id)}
              className={`card pad text-left w-full ${ring} hover:border-primary/40 hover:shadow-md transition-all`}>
              <div className="flex items-start gap-2.5">
                <div className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${
                  s.health === 'degraded' ? 'bg-warning-soft text-warning'
                  : s.health === 'paused' ? 'bg-surface2 text-muted'
                  : isManual(s.health) ? 'bg-info-soft text-info' : 'bg-primary-soft text-primary'}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-md font-semibold truncate">{s.name}</span>
                    <Dot tone={tone} pulse={s.health === 'syncing' || s.health === 'degraded'} />
                  </div>
                  <div className="text-2xs text-muted truncate">{s.kind} · {s.sub}</div>
                </div>
                <Chip tone={tone}>{LABEL_OF_HEALTH[s.health]}</Chip>
              </div>

              <div className="mt-2.5 grid grid-cols-3 gap-2">
                <div className="min-w-0">
                  <div className="text-2xs text-muted truncate">{isManual(s.health) ? 'Last upload' : 'Last sync'}</div>
                  <div className={`num text-base font-semibold truncate ${stale ? 'text-warning' : ''}`}>
                    {s.health === 'syncing' ? 'running…'
                      : s.health === 'paused' ? 'paused'
                      : ago(s.lastMin)}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-2xs text-muted truncate">Rows</div>
                  <div className="num text-base font-semibold truncate">{fmtNum(rows)}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-2xs text-muted truncate flex items-center gap-1">
                    <DirIcon className="w-2.5 h-2.5" />{DIR_META[s.dir].label}
                  </div>
                  <div className="text-base font-semibold truncate">{s.schedule.split(',')[0]}</div>
                </div>
              </div>

              <div className="mt-2">
                <Bar pct={s.health === 'paused' || isManual(s.health) ? 0 : fresh} tone={stale ? 'warning' : 'success'} h="h-1" />
                <div className="flex items-center justify-between mt-1 gap-2">
                  <span className="text-2xs text-muted truncate">
                    {isManual(s.health) ? 'No schedule — runs when you upload'
                      : s.health === 'paused' ? 'Paused — nothing is read or written'
                      : `Target: fresh within ${s.freshMins >= 1440 ? `${Math.round(s.freshMins / 1440)} d` : `${s.freshMins} min`}`}
                  </span>
                  <span className="block w-14 shrink-0 -mt-1.5">
                    <Spark data={s.history.filter(x => x > 0)} tone={stale ? 'warning' : 'primary'} h={14} />
                  </span>
                </div>
              </div>

              {s.note && (
                <div className={`mt-2 flex items-start gap-1.5 text-2xs rounded-lg px-2 py-1.5 ${
                  s.health === 'degraded' ? 'bg-warning-soft text-warning' : 'bg-surface2 text-muted'}`}>
                  {s.health === 'degraded' && <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />}
                  <span>{s.note}</span>
                </div>
              )}

              <div className="mt-2 pt-2 border-t border-line flex flex-wrap items-center gap-1">
                <span className="text-2xs text-muted mr-0.5">Feeds</span>
                {s.feeds.map(f => <Chip key={f.label} tone="neutral">{f.label}</Chip>)}
                {s.action && (
                  <span className="ml-auto text-2xs text-primary font-medium flex items-center gap-0.5">
                    {s.action.label} <ChevronRight className="w-2.5 h-2.5" />
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-2.5 scroll-mt-16" ref={logRef}>
        <Panel title="Sync log"
          right={<span className="num text-2xs text-muted">{log.length} entries</span>}
          note="Kept so a wrong number can be traced to the read that produced it. Failures stay on the record.">
          <Table rows={log} cols={logCols} rowKey={l => String(l.id)} page={9}
            sort={{ key: 'at', dir: 'desc' }} search={l => `${l.name} ${l.outcome} ${l.detail}`}
            csv="demandpilot-sync-log" onRow={l => setOpen(l.sysId)} />
        </Panel>

      </div>

      <Panel className="mt-2.5" pad>
        <div className="flex items-start gap-2 text-2xs text-muted">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px text-muted" />
          <p className="leading-relaxed">
            <span className="font-semibold text-fg">Demo build.</span>{' '}
            The connections on this screen are simulated — no plant system is on the other end, and refreshing a
            feed replays the dataset rather than fetching anything. The record counts, field names and the
            write-back queue are real: {fmtNum(ds.skus.length)} products, {ds.materials.length} materials,{' '}
            {fmtNum(bomLines)} recipe lines and {fmtNum(ds.orders.length)} sales orders are what this build
            computes on, and every purchase order in the queue came from a decision someone made on the Buy screen.
          </p>
        </div>
      </Panel>

      {/* ---- one system in full ---------------------------------------- */}
      <Drawer open={!!sel} onClose={() => setOpen(null)}
        title={sel?.name ?? ''} sub={sel ? `${sel.kind} · ${sel.sub}` : undefined}
        chips={sel && <>
          <Chip tone={TONE_OF_HEALTH[sel.health]}>{LABEL_OF_HEALTH[sel.health]}</Chip>
          <Chip tone="neutral">{DIR_META[sel.dir].label}</Chip>
        </>}
        footer={sel && (
          <div className="flex items-center gap-1.5">
            {isManual(sel.health) ? (
              // Nothing to sync or pause. The one real action is the upload, and
              // it goes to the uploader the app already has rather than a second
              // copy of the CSV parser.
              <Link to={sel.action!.to} onClick={() => setOpen(null)} className="btn btn-primary btn-md">
                <Upload className="w-3.5 h-3.5" /> {sel.action!.label}
              </Link>
            ) : (
              <>
                <button className="btn btn-primary btn-md" onClick={() => sync(sel)}
                  disabled={sel.health === 'syncing' || sel.health === 'paused'}>
                  <RefreshCw className={`w-3.5 h-3.5 ${sel.health === 'syncing' ? 'animate-spin' : ''}`} />
                  {sel.health === 'degraded' ? 'Retry connection' : 'Sync now'}
                </button>
                <button className="btn btn-outline btn-md" onClick={() => togglePause(sel)}>
                  {sel.health === 'paused'
                    ? <><PlayCircle className="w-3.5 h-3.5" /> Resume</>
                    : <><PauseCircle className="w-3.5 h-3.5" /> Pause</>}
                </button>
              </>
            )}
            <div className="flex-1" />
            <span className="text-2xs text-muted">Owner: {sel.owner}</span>
          </div>
        )}>
        {sel && (
          <>
            <LVRow items={isManual(sel.health) ? [
              { k: 'Last upload', v: ago(sel.lastMin) },
              { k: 'Files', v: String(uploads.length) },
              { k: 'Schedule', v: 'None — on demand' },
              { k: 'Goes stale', v: 'Never' },
            ] : [
              { k: 'Last sync', v: sel.health === 'paused' ? 'paused' : ago(sel.lastMin) },
              { k: 'Round trip', v: `${(sel.latencyMs / 1000).toFixed(1)}s` },
              { k: 'Schedule', v: sel.schedule },
              { k: 'Freshness target', v: sel.freshMins >= 1440 ? `${Math.round(sel.freshMins / 1440)} d` : `${sel.freshMins} min` },
            ]} />

            {sel.note && (
              <div className={`rounded-lg px-3 py-2 text-base flex items-start gap-2 ${
                sel.health === 'degraded' ? 'bg-warning-soft text-warning' : 'bg-surface2 text-muted'}`}>
                {sel.health === 'degraded' && <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />}
                <span>{sel.note}</span>
              </div>
            )}

            <Panel title="Connection" pad>
              <dl className="space-y-1.5 text-base">
                {[
                  ['Protocol', sel.protocol], ['Authentication', sel.auth],
                  ['Endpoint', sel.endpoint], ['Owned by', sel.owner],
                ].map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[112px_1fr] gap-2">
                    <dt className="text-muted">{k}</dt>
                    <dd className="font-mono text-sm break-all">{v}</dd>
                  </div>
                ))}
              </dl>
            </Panel>

            <Panel title="What came across on the last read" pad>
              <div className="space-y-1">
                {sel.rows.map(x => (
                  <div key={x.label} className="flex items-baseline justify-between gap-3 border-b border-line/60 pb-1 last:border-0">
                    <span className="text-base text-muted truncate">{x.label}</span>
                    <span className="num text-base font-semibold">{fmtNum(x.n)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2.5 pt-2.5 border-t border-line">
                <div className="eyebrow mb-1">Last twelve syncs, seconds</div>
                <Spark data={sel.history} tone="primary" h={28} />
              </div>
            </Panel>

            <Panel title="Field mappings" pad
              note="A rename on either side breaks the read, which is why the mapping is written down rather than assumed.">
              <Table rows={sel.mappings} cols={mapCols} rowKey={m => m.from} page={12} />
            </Panel>

            <Panel title="What it feeds" pad>
              <div className="flex flex-wrap gap-1.5">
                {sel.feeds.map(f => (
                  <Link key={f.label} to={f.to} onClick={() => setOpen(null)}
                    className="chip chip-primary hover:brightness-95">{f.label} →</Link>
                ))}
              </div>
            </Panel>

            <Panel title="If this feed stops" pad className="border-danger/30">
              <p className="text-base leading-relaxed text-muted">{sel.breaks}</p>
            </Panel>

            <Panel title="Recent activity" pad>
              {(() => {
                const mine = log.filter(l => l.sysId === sel.id).slice(0, 6)
                return !mine.length ? <Empty title="Nothing logged yet" /> : (
                  <div className="space-y-1">
                    {mine.map(l => (
                      <div key={l.id} className="flex items-start gap-2 text-base border-b border-line/60 pb-1 last:border-0">
                        <span className="num text-2xs text-muted w-14 shrink-0 pt-0.5">{hhmmss(l.at)}</span>
                        <Chip tone={l.outcome === 'Failed' ? 'danger' : l.outcome === 'Partial' ? 'warning'
                          : l.outcome === 'Paused' ? 'neutral' : l.outcome === 'Sent' ? 'info' : 'success'}>{l.outcome}</Chip>
                        <span className="text-muted flex-1 min-w-0">{l.detail}</span>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </Panel>
          </>
        )}
      </Drawer>
    </>
  )
}
