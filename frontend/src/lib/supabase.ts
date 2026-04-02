import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl) throw new Error('Missing VITE_SUPABASE_URL')
if (!supabaseAnonKey) throw new Error('Missing VITE_SUPABASE_ANON_KEY')

export const supabase: SupabaseClient = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    // For backend direct access with anon key, keep default auth behavior.
    auth: { persistSession: false, autoRefreshToken: false },
  },
)

export interface CustomerItemPrice {
  itemId: string
  requiresWeighing: boolean
  pricePerJin: number | null
  pricePerUnit: number | null
}

/**
 * 回傳某客戶對某品項的計價資訊。
 * - 若 `customer_item_prices` 存在，優先使用。
 * - 否則回退到 `items.default_price_per_jin/default_price_per_unit`。
 */
export async function getCustomerItemPrice(
  customerId: string,
  itemId: string,
): Promise<CustomerItemPrice> {
  const { data: item, error: itemErr } = await supabase
    .from('items')
    .select('id,requires_weighing,default_price_per_jin,default_price_per_unit')
    .eq('id', itemId)
    .maybeSingle()

  if (itemErr) throw itemErr
  if (!item) throw new Error(`Item not found: ${itemId}`)

  const { data: cip, error: cipErr } = await supabase
    .from('customer_item_prices')
    .select('price_per_jin,price_per_unit')
    .eq('customer_id', customerId)
    .eq('item_id', itemId)
    .maybeSingle()

  if (cipErr) throw cipErr

  const requiresWeighing = item.requires_weighing === true

  const pricePerJinRaw = requiresWeighing ? (cip?.price_per_jin ?? item.default_price_per_jin) : null
  const pricePerUnitRaw = !requiresWeighing ? (cip?.price_per_unit ?? item.default_price_per_unit) : null

  const pricePerJin = pricePerJinRaw === null ? null : Number(pricePerJinRaw)
  const pricePerUnit = pricePerUnitRaw === null ? null : Number(pricePerUnitRaw)

  return {
    itemId,
    requiresWeighing,
    pricePerJin,
    pricePerUnit,
  }
}

