/**
 * The alert rules.
 *
 * These lived inside `screens/Setup.tsx`, which meant the Connected systems
 * screen could show "an alert went out" without being able to name the rule
 * that sent it, or link to it. One list, read by both: Setup renders and toggles
 * them, Connected cites them on every outbound alert.
 *
 * `id` is what other screens reference. The rest is what a planner sees.
 */
export type AlertChannel = 'Email' | 'SMS' | 'In-app'
export type AlertSeverity = 'Critical' | 'High' | 'Medium' | 'Low'

export interface AlertRule {
  id: string
  /** Rule name, as shown in Setup. */
  name: string
  /** What fires it. */
  trigger: string
  channels: AlertChannel[]
  who: string
  /** How often it is allowed to fire. */
  frequency: string
  severity: AlertSeverity
  /** Where in the app you go to act on it. */
  linkTo: string
}

export const ALERT_RULES: AlertRule[] = [
  { id: 'cover-critical', name: 'Cover critical', trigger: 'Cover < 3 days', channels: ['Email', 'SMS', 'In-app'], who: 'Planner, Buyer', frequency: 'Immediate', severity: 'Critical', linkTo: '/stock' },
  { id: 'cover-low', name: 'Cover low', trigger: 'Cover 3–7 days', channels: ['Email', 'In-app'], who: 'Planner', frequency: 'Daily digest', severity: 'High', linkTo: '/stock' },
  { id: 'cover-watch', name: 'Cover watch', trigger: 'Cover 7–14 days', channels: ['In-app'], who: 'Planner', frequency: 'Weekly digest', severity: 'Medium', linkTo: '/stock' },
  { id: 'order-by-passed', name: 'Order-by passed', trigger: 'Usual supplier can no longer make the date', channels: ['Email', 'SMS'], who: 'Planner, Buyer', frequency: 'Immediate', severity: 'Critical', linkTo: '/buy' },
  { id: 'anomaly-high', name: 'High anomaly', trigger: 'Demand anomaly rated High', channels: ['Email', 'In-app'], who: 'Planner, Sales', frequency: 'Immediate', severity: 'High', linkTo: '/anomalies' },
  { id: 'accuracy-slipping', name: 'Accuracy slipping', trigger: 'A product moves to "Getting worse"', channels: ['Email'], who: 'Planner', frequency: 'Weekly', severity: 'Medium', linkTo: '/forecast?tab=accuracy' },
  { id: 'over-capacity', name: 'Over capacity', trigger: 'Plan exceeds a line in any week', channels: ['Email', 'In-app'], who: 'Planner, Production', frequency: 'Daily', severity: 'High', linkTo: '/plan' },
  { id: 'excess-building', name: 'Excess building', trigger: 'Cover above the excess target', channels: ['In-app'], who: 'Planner, Finance', frequency: 'Monthly', severity: 'Low', linkTo: '/stock' },
  { id: 'delivery-slipped', name: 'Delivery slipped', trigger: 'Supplier advises a later date', channels: ['Email', 'In-app'], who: 'Buyer', frequency: 'Immediate', severity: 'High', linkTo: '/orders' },
  { id: 'shelf-life', name: 'Shelf life', trigger: 'Stock expires within 30 days', channels: ['Email', 'In-app'], who: 'Warehouse', frequency: 'Weekly', severity: 'Medium', linkTo: '/stock' },
  { id: 'sole-source', name: 'Sole source', trigger: 'Critical material with no alternative', channels: ['Email'], who: 'Buyer', frequency: 'Monthly', severity: 'Medium', linkTo: '/stock' },
  { id: 'price-moved', name: 'Price moved', trigger: 'A commodity index moves over 8% in six weeks', channels: ['Email'], who: 'Buyer, Finance', frequency: 'On occurrence', severity: 'Medium', linkTo: '/anomalies' },
]

export const alertRule = (id: string): AlertRule | undefined => ALERT_RULES.find(r => r.id === id)
