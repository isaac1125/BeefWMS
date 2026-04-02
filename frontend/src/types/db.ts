export interface ItemRow {
  id: string
  name: string
  enabled: boolean
  requires_weighing: boolean
  default_price_per_jin: number | null
  default_price_per_unit: number | null
}

export interface CustomerRow {
  id: string
  name: string
  enabled: boolean
}

export type PickupStatus = 'pending' | 'billed' | 'cancelled'

export interface PickupRow {
  id: string
  customer_id: string
  item_id: string
  quantity: number
  pickup_date: string // YYYY-MM-DD
  pickup_status: PickupStatus
}

export interface InventoryRecordRow {
  id: string
  item_id: string
  record_date: string // YYYY-MM-DD
  previous_remaining: number
  current_inbound: number
  current_total: number
}

export interface BillingRecordRow {
  id: string
  pickup_id: string
  customer_id: string
  item_id: string
  weight_jin: number | null
  weight_liang: number | null
  total_amount: number
  paid_amount: number
  previous_debt: number
  current_debt: number
  billing_date: string | null
}

