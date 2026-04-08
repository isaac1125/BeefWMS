<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { endOfMonth, startOfMonth } from 'date-fns'
import { useRoute } from 'vue-router'

import { supabase, getCustomerItemPrice, type CustomerItemPrice } from '../lib/supabase'
import { toISODate } from '../lib/week'
import { jinLiangToTotalLiang, jinLiangToJinDecimal, calcAmountByTotalLiang } from '../lib/weight'
import { useCatalogStore } from '../stores/catalog'
import type { ItemRow, PickupRow, PaymentRecordRow } from '../types/db'
import DatePickerField from '../components/inputs/DatePickerField.vue'

defineOptions({ name: 'BillingPageV2' })

const catalog = useCatalogStore()
const route = useRoute()

const loading = ref(false)
const errorMessage = ref<string | null>(null)
const successMessage = ref<string | null>(null)

const todayISO = toISODate(new Date())
const monthStartISO = toISODate(startOfMonth(new Date()))
const monthEndISO = toISODate(endOfMonth(new Date()))

const activeTab = ref<'weighing' | 'payment' | 'quotes'>('weighing')

const selectedCustomerId = ref<string | null>(null)
const pendingPickups = ref<PickupRow[]>([])
const selectedOrderDate = ref<string | null>(null)
const isOrderSaveModalOpen = ref(false)
const isOrderSavedModalOpen = ref(false)

// pricing per item for the currently selected order date
const orderPricesByItemId = ref<Record<string, CustomerItemPrice>>({})

// weight inputs by pickup_id
const weightJinByPickupId = ref<Record<string, number>>({})
const weightLiangByPickupId = ref<Record<string, number>>({})

/** 登記收款：只輸入金額，可分批；分配順序與「報價單日期」無關 */
const paidTodayAmount = ref<number>(0)
const paymentDateISO = ref<string>(todayISO)
/** 儲存秤重報價時寫入 billing_records.billing_date（報價單日期／入帳日） */
const billingDateISO = ref<string>(todayISO)

// wage helper: total jin per customer in current month
const monthJinByCustomerId = ref<Record<string, number>>({})

// monthly quotes (billing_records) for selected customer
const monthlyQuotes = ref<
  Array<{
    id: string
    pickup_id: string
    customer_id: string
    item_id: string
    weight_jin: number | null
    weight_liang: number | null
    total_amount: number
    paid_amount: number
    current_debt: number
    billing_date: string | null
    /** 取自關聯 pickups.quantity；免秤重品項顯示包數用 */
    pickup_quantity: number | null
  }>
>([])

const paymentRecords = ref<PaymentRecordRow[]>([])

function isMissingPaymentRecordsTable(err: unknown): boolean {
  const msg =
    typeof err === 'string'
      ? err
      : (err as any)?.message || (err as any)?.error_description || (err as any)?.hint || ''
  return String(msg).includes('payment_records') && String(msg).includes('does not exist')
}

async function loadPaymentRecords(customerId: string) {
  const { data, error } = await supabase
    .from('payment_records')
    .select('id,customer_id,payment_date,amount,created_at')
    .eq('customer_id', customerId)
    .order('payment_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) {
    if (isMissingPaymentRecordsTable(error)) {
      paymentRecords.value = []
      return
    }
    throw error
  }
  paymentRecords.value = (data ?? []) as PaymentRecordRow[]
}

function currency(n: number): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return '0'
  return Math.trunc(v).toString()
}

/** 報價單日期顯示為 M/D，不含年份（非 ISO 或「未設定日期」則原樣） */
function formatBillingDateShort(dateKey: string): string {
  if (dateKey === '未設定日期') return dateKey
  const parts = String(dateKey).split('-')
  if (parts.length < 3) return dateKey
  const m = Number(parts[1])
  const d = Number(parts[2])
  if (!Number.isFinite(m) || !Number.isFinite(d)) return dateKey
  return `${m}/${d}`
}

/** 區間顯示為 M/D ~ M/D（解析失敗則 fallback 原字串） */
function formatRangeNoYear(fromISO: string, toISO: string): string {
  const f = String(fromISO).split('-')
  const t = String(toISO).split('-')
  if (f.length >= 3 && t.length >= 3) {
    const fm = Number(f[1])
    const fd = Number(f[2])
    const tm = Number(t[1])
    const td = Number(t[2])
    if ([fm, fd, tm, td].every(Number.isFinite)) return `${fm}/${fd} ~ ${tm}/${td}`
  }
  return `${fromISO} ~ ${toISO}`
}

const enabledCustomers = computed(() => catalog.customers.filter((c) => c.enabled))

/** 報價單分頁底部「本月斤數」列舉客戶的合計 */
const monthJinTotalForWage = computed(() => {
  return enabledCustomers.value.reduce((sum, c) => {
    const j = Number(monthJinByCustomerId.value[c.id] ?? 0)
    return sum + (Number.isFinite(j) ? Math.max(0, j) : 0)
  }, 0)
})

function formatWageJinDisplay(v: number | undefined): string {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return '0'
  const x = Math.round(n * 10) / 10
  return Number.isInteger(x) ? String(x) : x.toFixed(1)
}

// quotes range (default: this month)
const quoteFromISO = ref<string>(monthStartISO)
const quoteToISO = ref<string>(monthEndISO)

const pendingOrderDates = computed(() => {
  const set = new Set(pendingPickups.value.map((p) => p.pickup_date))
  return Array.from(set.values()).sort((a, b) => (a < b ? -1 : 1))
})

const selectedOrderPickups = computed(() => {
  if (!selectedOrderDate.value) return []
  const list = pendingPickups.value.filter((p) => p.pickup_date === selectedOrderDate.value)
  return [...list].sort((a, b) => compareCatalogItemOrder(a.item_id, b.item_id))
})

function getItemName(itemId: string): string {
  return catalog.items.find((i: ItemRow) => i.id === itemId)?.name ?? 'Unknown'
}

function getItemById(itemId: string): ItemRow | undefined {
  return catalog.items.find((i: ItemRow) => i.id === itemId)
}

/** 與設定頁／catalog.items 順序一致（含 sort_order／本機排序）；未知品項排在最後 */
function compareCatalogItemOrder(itemIdA: string, itemIdB: string): number {
  const indexOf = (id: string) => {
    const i = catalog.items.findIndex((x: ItemRow) => x.id === id)
    return i === -1 ? 999999 : i
  }
  const ia = indexOf(itemIdA)
  const ib = indexOf(itemIdB)
  if (ia !== ib) return ia - ib
  return getItemName(itemIdA).localeCompare(getItemName(itemIdB), 'zh-Hant')
}

function getPriceForPickup(p: PickupRow): CustomerItemPrice | undefined {
  return orderPricesByItemId.value[p.item_id]
}

function getPriceTextForPickup(p: PickupRow): string {
  const price = getPriceForPickup(p)
  if (!price) return '-'
  if (price.requiresWeighing) return `${currency(price.pricePerJin ?? 0)} 元/斤`
  return `${currency(price.pricePerUnit ?? 0)} 元/個`
}

function calcPickupTotalAmount(p: PickupRow): number {
  const item = getItemById(p.item_id)
  const price = getPriceForPickup(p)
  if (!item || !price) return 0

  if (price.requiresWeighing) {
    const jin = Math.max(0, Number(weightJinByPickupId.value[p.id] ?? 0))
    const liangRaw = Number(weightLiangByPickupId.value[p.id] ?? 0)
    const liang = Math.min(15, Math.max(0, Math.trunc(liangRaw)))
    const totalLiang = jinLiangToTotalLiang(Math.trunc(jin), liang)
    const perJin = price.pricePerJin ?? 0
    return calcAmountByTotalLiang(totalLiang, perJin)
  }

  // non-weighing item: amount = packages * price_per_unit
  const unit = price.pricePerUnit ?? 0
  const packages = Math.trunc(Number(p.quantity ?? 0))
  return packages * unit
}

const selectedOrderTotalAmount = computed(() => {
  return selectedOrderPickups.value.reduce((acc, p) => acc + calcPickupTotalAmount(p), 0)
})

const orderSaveSummaryRows = computed(() => {
  return selectedOrderPickups.value.map((p) => {
    const price = orderPricesByItemId.value[p.item_id]
    const requiresWeighing = price?.requiresWeighing === true
    const jin = Math.max(0, Math.trunc(Number(weightJinByPickupId.value[p.id] ?? 0)))
    const liang = Math.min(15, Math.max(0, Math.trunc(Number(weightLiangByPickupId.value[p.id] ?? 0))))
    const weightText = requiresWeighing ? `${jin}斤${liang}兩` : '免秤重'
    const amount = calcPickupTotalAmount(p)
    return {
      pickupId: p.id,
      itemName: getItemName(p.item_id),
      quantity: Math.trunc(Number(p.quantity ?? 0)),
      priceText: getPriceTextForPickup(p),
      requiresWeighing,
      weightText,
      amount,
    }
  })
})

function requestSubmitSelectedOrderBilling() {
  errorMessage.value = null
  successMessage.value = null
  if (!selectedCustomerId.value || !selectedOrderDate.value) return
  if (selectedOrderPickups.value.length === 0) return
  isOrderSaveModalOpen.value = true
}

const monthlyUnpaidTotal = computed(() => {
  return monthlyQuotes.value.reduce((acc, q) => acc + Number(q.current_debt ?? 0), 0)
})
const expandedInvoiceDate = ref<string | null>(null)

const groupedMonthlyQuotes = computed(() => {
  const map = new Map<
    string,
    {
      billingDate: string
      totalAmount: number
      paidAmount: number
      currentDebt: number
      itemCount: number
    }
  >()

  monthlyQuotes.value.forEach((q) => {
    const dateKey = q.billing_date ?? '未設定日期'
    const row = map.get(dateKey) ?? {
      billingDate: dateKey,
      totalAmount: 0,
      paidAmount: 0,
      currentDebt: 0,
      itemCount: 0,
    }
    row.totalAmount += Number(q.total_amount ?? 0)
    row.paidAmount += Number(q.paid_amount ?? 0)
    row.currentDebt += Number(q.current_debt ?? 0)
    row.itemCount += 1
    map.set(dateKey, row)
  })

  return Array.from(map.values()).sort((a, b) => (a.billingDate < b.billingDate ? 1 : -1))
})

function formatQuoteDetailSpec(q: (typeof monthlyQuotes.value)[number]): string {
  const hasWeight = q.weight_jin != null || q.weight_liang != null
  if (hasWeight) {
    return `重 ${Math.trunc(Number(q.weight_jin ?? 0))}斤${Math.trunc(Number(q.weight_liang ?? 0))}兩`
  }
  const pk = q.pickup_quantity
  if (pk != null && Number.isFinite(pk)) {
    const n = Math.max(0, Math.trunc(Number(pk)))
    return `${n} 包`
  }
  return '包數 —'
}

const groupedInvoiceDetails = computed(() => {
  const map: Record<
    string,
    Array<{
      id: string
      itemId: string
      itemName: string
      specText: string
      amountText: string
    }>
  > = {}

  monthlyQuotes.value.forEach((q) => {
    const dateKey = q.billing_date ?? '未設定日期'
    if (!map[dateKey]) map[dateKey] = []

    map[dateKey].push({
      id: q.id,
      itemId: q.item_id,
      itemName: getItemName(q.item_id),
      specText: formatQuoteDetailSpec(q),
      amountText: `${currency(q.total_amount)} 元`,
    })
  })

  for (const k of Object.keys(map)) {
    map[k].sort((a, b) => compareCatalogItemOrder(a.itemId, b.itemId))
  }

  return map
})

async function loadPendingPickups(customerId: string) {
  errorMessage.value = null
  successMessage.value = null
  pendingPickups.value = []
  orderPricesByItemId.value = {}
  weightJinByPickupId.value = {}
  weightLiangByPickupId.value = {}
  paidTodayAmount.value = 0
  selectedOrderDate.value = null

  loading.value = true
  try {
    const { data, error } = await supabase
      .from('pickups')
      .select('id,customer_id,item_id,quantity,pickup_date,pickup_status')
      .eq('customer_id', customerId)
      .eq('pickup_status', 'pending')
      .order('pickup_date', { ascending: false })

    if (error) throw error
    pendingPickups.value = (data ?? []) as PickupRow[]

    // default select newest order date
    if (pendingOrderDates.value.length > 0) {
      selectedOrderDate.value = pendingOrderDates.value[0]
    }
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to load pending pickups'
  } finally {
    loading.value = false
  }
}

async function loadOrderPricesAndInitWeights() {
  if (!selectedCustomerId.value) return
  if (!selectedOrderDate.value) return

  const pickups = selectedOrderPickups.value
  const uniqueItemIds = Array.from(new Set(pickups.map((p) => p.item_id)))

  const prices = await Promise.all(
    uniqueItemIds.map((itemId) => getCustomerItemPrice(selectedCustomerId.value!, itemId)),
  )

  const next: Record<string, CustomerItemPrice> = {}
  uniqueItemIds.forEach((id, idx) => {
    next[id] = prices[idx]
  })
  orderPricesByItemId.value = next

  // init weights for weighing items
  const nextJin: Record<string, number> = {}
  const nextLiang: Record<string, number> = {}
  pickups.forEach((p) => {
    const price = next[p.item_id]
    if (price?.requiresWeighing) {
      nextJin[p.id] = 0
      nextLiang[p.id] = 0
    }
  })
  weightJinByPickupId.value = nextJin
  weightLiangByPickupId.value = nextLiang
}

async function loadMonthJinForAllCustomers() {
  if (catalog.customers.length === 0) return
  const { data, error } = await supabase
    .from('billing_records')
    .select('customer_id,weight_jin,weight_liang,billing_date')
    .gte('billing_date', monthStartISO)
    .lte('billing_date', monthEndISO)

  if (error) throw error

  const map: Record<string, number> = {}
  ;(data ?? []).forEach((r: any) => {
    const cid = r.customer_id as string
    const j = r.weight_jin == null ? 0 : Number(r.weight_jin)
    const l = r.weight_liang == null ? 0 : Number(r.weight_liang)
    const add = jinLiangToJinDecimal(j, l)
    if (!Number.isFinite(add)) return
    map[cid] = (map[cid] ?? 0) + add
  })
  monthJinByCustomerId.value = map
}

async function loadQuotesForRange(customerId: string, fromISO: string, toISO: string) {
  const { data, error } = await supabase
    .from('billing_records')
    .select(
      'id,pickup_id,customer_id,item_id,weight_jin,weight_liang,total_amount,paid_amount,current_debt,billing_date,pickups(quantity)',
    )
    .eq('customer_id', customerId)
    .gte('billing_date', fromISO)
    .lte('billing_date', toISO)
    .order('billing_date', { ascending: false })

  if (error) throw error

  monthlyQuotes.value = ((data ?? []) as any[]).map((r) => {
    const emb = r.pickups
    let pickup_quantity: number | null = null
    if (emb && typeof emb === 'object' && emb.quantity != null) {
      const n = Math.trunc(Number(emb.quantity))
      pickup_quantity = Number.isFinite(n) ? Math.max(0, n) : null
    }
    const { pickups: _drop, ...rest } = r
    return { ...rest, pickup_quantity } as (typeof monthlyQuotes.value)[number]
  })
}

async function submitSelectedOrderBilling() {
  if (!selectedCustomerId.value) return
  if (!selectedOrderDate.value) return

  const pickups = selectedOrderPickups.value
  if (pickups.length === 0) return

  errorMessage.value = null
  successMessage.value = null
  loading.value = true
  try {
    isOrderSaveModalOpen.value = false
    // 與畫面／報價單明細相同：依 catalog 品項順序
    const sortedPickups = [...pickups].sort((a, b) => compareCatalogItemOrder(a.item_id, b.item_id))

    // compute totals upfront
    const totals = sortedPickups.map((p) => calcPickupTotalAmount(p))

    // 插入報價資料；收款改為獨立流程（客戶+日期+金額）
    for (let i = 0; i < sortedPickups.length; i++) {
      const p = sortedPickups[i]
      const totalAmount = Number(totals[i] ?? 0)

      const price = orderPricesByItemId.value[p.item_id]
      const requiresWeighing = price?.requiresWeighing === true

      const weightJin = requiresWeighing ? Math.trunc(Number(weightJinByPickupId.value[p.id] ?? 0)) : null
      const weightLiang = requiresWeighing
        ? Math.min(15, Math.max(0, Math.trunc(Number(weightLiangByPickupId.value[p.id] ?? 0))))
        : null

      const currentDebt = Math.max(0, totalAmount)

      const payload: any = {
        pickup_id: p.id,
        customer_id: p.customer_id,
        item_id: p.item_id,
        total_amount: totalAmount,
        paid_amount: 0,
        previous_debt: 0,
        current_debt: currentDebt,
        billing_date: billingDateISO.value,
        weight_jin: requiresWeighing ? weightJin : null,
        weight_liang: requiresWeighing ? weightLiang : null,
      }

      const { error: insErr } = await supabase.from('billing_records').insert(payload)
      if (insErr) throw insErr
    }

    const ids = sortedPickups.map((p) => p.id)
    const { error: updErr } = await supabase
      .from('pickups')
      .update({ pickup_status: 'billed' })
      .in('id', ids)

    if (updErr) throw updErr

    successMessage.value = '已儲存秤重報價（收款請用上方獨立收款區）'

    // refresh
    await loadPendingPickups(selectedCustomerId.value)
    await loadQuotesForRange(selectedCustomerId.value, quoteFromISO.value, quoteToISO.value)
    await loadMonthJinForAllCustomers()
    isOrderSavedModalOpen.value = true
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to submit billing'
  } finally {
    loading.value = false
  }
}

async function receiveCustomerPayment() {
  if (!selectedCustomerId.value) return
  const payNow = Math.max(0, Math.trunc(Number(paidTodayAmount.value ?? 0)))
  if (payNow <= 0) return

  loading.value = true
  try {
    const { data, error } = await supabase
      .from('billing_records')
      .select('id,total_amount,paid_amount,current_debt,billing_date')
      .eq('customer_id', selectedCustomerId.value)
      .gt('current_debt', 0)
      .order('billing_date', { ascending: true })

    if (error) throw error

    const rows = (data ?? []) as Array<{
      id: string
      total_amount: number
      paid_amount: number
      current_debt: number
      billing_date: string | null
    }>

    let remain = payNow
    for (const row of rows) {
      if (remain <= 0) break
      const debt = Number(row.current_debt ?? 0)
      if (debt <= 0) continue

      const pay = Math.min(remain, debt)
      remain -= pay

      const nextPaid = Number(row.paid_amount ?? 0) + pay
      const nextDebt = Math.max(0, Number(row.total_amount ?? 0) - nextPaid)

      const { error: updErr } = await supabase
        .from('billing_records')
        .update({
          paid_amount: nextPaid,
          current_debt: nextDebt,
        })
        .eq('id', row.id)

      if (updErr) throw updErr
    }

    const { error: insPayErr } = await supabase.from('payment_records').insert({
      customer_id: selectedCustomerId.value,
      payment_date: paymentDateISO.value,
      amount: payNow,
    })
    if (insPayErr && !isMissingPaymentRecordsTable(insPayErr)) throw insPayErr

    paidTodayAmount.value = 0
    successMessage.value = insPayErr ? '已登記收款（收款紀錄表尚未建立）' : '已登記收款'
    await loadQuotesForRange(selectedCustomerId.value!, quoteFromISO.value, quoteToISO.value)
    await loadPaymentRecords(selectedCustomerId.value!)
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to update payment'
  } finally {
    loading.value = false
  }
}

watch(selectedCustomerId, (val) => {
  if (!val) return
  void loadPendingPickups(val)
  expandedInvoiceDate.value = null
  void loadQuotesForRange(val, quoteFromISO.value, quoteToISO.value)
  void loadPaymentRecords(val).catch(() => {})
})

watch(selectedOrderDate, (val) => {
  if (!val) return
  void loadOrderPricesAndInitWeights()
})

watch([quoteFromISO, quoteToISO], ([fromISO, toISO]) => {
  if (!selectedCustomerId.value) return
  expandedInvoiceDate.value = null
  void loadQuotesForRange(selectedCustomerId.value, fromISO, toISO)
})

onMounted(async () => {
  if (catalog.customers.length === 0 || catalog.items.length === 0) await catalog.loadAll()
  const qCustomerId = typeof route.query.customerId === 'string' ? route.query.customerId : null
  const qOrderDate = typeof route.query.orderDate === 'string' ? route.query.orderDate : null

  selectedCustomerId.value = qCustomerId && enabledCustomers.value.some((c) => c.id === qCustomerId) ? qCustomerId : (enabledCustomers.value[0]?.id ?? null)

  if (selectedCustomerId.value) {
    await loadMonthJinForAllCustomers()
    await loadPendingPickups(selectedCustomerId.value)
    await loadQuotesForRange(selectedCustomerId.value, quoteFromISO.value, quoteToISO.value)
    await loadPaymentRecords(selectedCustomerId.value)

    if (qOrderDate && pendingOrderDates.value.includes(qOrderDate)) {
      selectedOrderDate.value = qOrderDate
    }
  }
})
</script>

<template>
  <div class="p-4 bg-slate-50/70 min-h-full">
    <div
      v-if="isOrderSavedModalOpen"
      class="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-900/40 p-4 pb-[max(1rem,calc(5.5rem+env(safe-area-inset-bottom)))] sm:pb-4"
      @click.self="isOrderSavedModalOpen = false"
    >
      <div class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
        <div class="text-base font-bold text-slate-900">修改完成</div>
        <div class="mt-2 text-sm text-slate-700">已成功儲存報價單。</div>
        <div class="mt-4">
          <button class="btn-primary w-full" @click="isOrderSavedModalOpen = false">知道了</button>
        </div>
      </div>
    </div>

    <div
      v-if="isOrderSaveModalOpen"
      class="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-900/40 p-4 pb-[max(1rem,calc(5.5rem+env(safe-area-inset-bottom)))] sm:pb-4"
      @click.self="isOrderSaveModalOpen = false"
    >
      <div class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
        <div class="text-base font-bold text-slate-900">存檔摘要</div>
        <div class="mt-2 text-sm text-slate-700">
          客戶：{{ enabledCustomers.find((c) => c.id === selectedCustomerId)?.name ?? '-' }}
        </div>
        <div class="mt-1 text-sm text-slate-700">取貨日期：{{ selectedOrderDate }}</div>

        <div class="mt-3 max-h-72 overflow-auto rounded-xl border border-slate-200">
          <table class="w-full text-sm bg-white">
            <thead class="text-left text-slate-500 bg-slate-50/80">
              <tr>
                <th class="py-2 px-3">品項</th>
                <th class="py-2 px-3 text-right">包數</th>
                <th class="py-2 px-3 text-right">重量</th>
                <th class="py-2 px-3 text-right">金額</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in orderSaveSummaryRows" :key="r.pickupId" class="border-t border-slate-100">
                <td class="py-2 px-3 font-semibold text-slate-900 whitespace-nowrap">{{ r.itemName }}</td>
                <td class="py-2 px-3 text-right text-slate-700 whitespace-nowrap">{{ r.quantity }}</td>
                <td class="py-2 px-3 text-right text-slate-700 whitespace-nowrap">{{ r.weightText }}</td>
                <td class="py-2 px-3 text-right font-bold text-slate-900 whitespace-nowrap">{{ currency(r.amount) }} 元</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm font-semibold text-slate-700">本單總金額</div>
            <div class="text-lg font-bold text-slate-900 whitespace-nowrap">{{ currency(selectedOrderTotalAmount) }} 元</div>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-2">
          <button class="btn-ghost w-full bg-white" :disabled="loading" @click="isOrderSaveModalOpen = false">取消</button>
          <button class="btn-primary w-full" :disabled="loading" @click="submitSelectedOrderBilling">確認存檔</button>
        </div>
      </div>
    </div>

    <div class="mx-auto w-full max-w-3xl space-y-4">
      <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h1 class="text-xl font-bold tracking-tight text-slate-900">結帳中心</h1>
            <div class="mt-1 text-xs text-slate-600">秤重報價、收款、未付查詢</div>
          </div>
          <div class="text-xs text-slate-600" v-if="loading">處理中...</div>
        </div>

        <div class="mt-4">
          <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div class="label mb-1">選客戶</div>
            <select class="field" v-model="selectedCustomerId">
              <option v-for="c in enabledCustomers" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>

            <div v-if="errorMessage" class="mt-2 text-sm text-red-600">{{ errorMessage }}</div>
            <div v-if="successMessage" class="mt-2 text-sm text-green-700">{{ successMessage }}</div>

            <div class="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                class="rounded-xl border px-3 py-2 text-sm font-bold"
                :class="activeTab === 'weighing' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-700'"
                @click="activeTab = 'weighing'"
              >
                秤重
              </button>
              <button
                type="button"
                class="rounded-xl border px-3 py-2 text-sm font-bold"
                :class="activeTab === 'payment' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-700'"
                @click="activeTab = 'payment'"
              >
                收款
              </button>
              <button
                type="button"
                class="rounded-xl border px-3 py-2 text-sm font-bold"
                :class="activeTab === 'quotes' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-700'"
                @click="activeTab = 'quotes'"
              >
                報價單
              </button>
            </div>
          </div>
        </div>
      </div>

      <template v-if="activeTab === 'weighing'">
        <div class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div class="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-3">
            <div class="label mb-1">報價單日期</div>
            <DatePickerField v-model="billingDateISO" />
            <p class="mt-1.5 text-[11px] leading-relaxed text-slate-500">只影響「儲存秤重報價」建立的新報價單日期。</p>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div class="text-sm font-bold text-slate-900">待秤重的單（按日期）</div>
            <div v-if="pendingOrderDates.length === 0" class="mt-2 text-sm text-slate-600">目前沒有待秤重取貨單</div>
            <div v-else class="mt-3 space-y-2">
              <div
                v-for="d in pendingOrderDates"
                :key="d"
                class="rounded-xl border border-slate-200 bg-white p-2 cursor-pointer transition-colors duration-200"
                :class="selectedOrderDate === d ? 'border-brand-500 ring-2 ring-brand-300/40' : 'hover:bg-slate-50'"
                @click="selectedOrderDate = d"
              >
                <div class="text-xs text-slate-600">日期</div>
                <div class="text-sm font-bold text-slate-900">{{ d }}</div>
              </div>
            </div>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm" v-if="selectedOrderDate">
            <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <div class="text-base font-bold tracking-tight text-slate-900">秤重報價單</div>
                  <div class="mt-1 text-xs text-slate-600">取貨日期：{{ selectedOrderDate }}</div>
                </div>
              </div>
            </div>

            <div class="mt-3 space-y-2">
              <div v-for="p in selectedOrderPickups" :key="p.id" class="rounded-xl border border-slate-200 bg-white p-3">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-bold text-slate-900">{{ getItemName(p.item_id) }}</div>
                    <div class="mt-1 text-sm font-semibold text-slate-700">{{ p.quantity }} 包</div>
                  </div>
                  <div class="shrink-0 text-right text-sm font-semibold text-slate-700 tabular-nums leading-snug">
                    {{ getPriceTextForPickup(p) }}
                  </div>
                </div>

                <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div class="flex items-center gap-2 overflow-x-auto whitespace-nowrap [-webkit-overflow-scrolling:touch]">
                    <template v-if="orderPricesByItemId[p.item_id]?.requiresWeighing">
                      <input
                        class="field w-16 sm:w-20 text-right"
                        type="number"
                        min="0"
                        max="99"
                        step="1"
                        inputmode="numeric"
                        :value="weightJinByPickupId[p.id] ?? 0"
                        @input="
                          weightJinByPickupId[p.id] = Math.min(
                            99,
                            Math.max(0, Math.trunc(Number(($event.target as HTMLInputElement).valueAsNumber ?? 0))),
                          )
                        "
                      />
                      <div class="text-sm font-semibold text-slate-700 shrink-0">斤</div>
                      <input
                        class="field w-16 sm:w-20 text-right"
                        type="number"
                        min="0"
                        max="15"
                        step="1"
                        inputmode="numeric"
                        :value="weightLiangByPickupId[p.id] ?? 0"
                        @input="
                          weightLiangByPickupId[p.id] = Math.min(
                            15,
                            Math.max(0, Math.trunc(Number(($event.target as HTMLInputElement).valueAsNumber ?? 0))),
                          )
                        "
                      />
                      <div class="text-sm font-semibold text-slate-700 shrink-0">兩</div>
                    </template>
                    <template v-else>
                      <div class="text-xs text-slate-600 shrink-0">免秤重（依包數計價）</div>
                    </template>
                  </div>

                  <div class="flex items-center justify-between gap-3 whitespace-nowrap sm:justify-end sm:shrink-0">
                    <div class="text-sm font-semibold text-slate-600">金額</div>
                    <div class="text-sm font-bold text-brand-600 tabular-nums">{{ currency(calcPickupTotalAmount(p)) }} 元</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="mt-4">
              <button class="btn-primary w-full" :disabled="loading" @click="requestSubmitSelectedOrderBilling">儲存秤重報價</button>
            </div>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm" v-else>
            <div class="text-sm font-bold text-slate-900">請先選擇待秤重的日期</div>
          </div>
        </div>
      </template>

      <template v-else-if="activeTab === 'payment'">
        <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="text-base font-bold tracking-tight text-slate-900">登記收款</div>
          <div class="mt-1 text-xs text-slate-600">可分批收款；系統依未付欠款由舊到新分配。</div>

          <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div class="label mb-1">收款日期</div>
            <DatePickerField v-model="paymentDateISO" />
            <div class="label mb-1">本次收款金額</div>
            <input
              class="field"
              type="number"
              min="0"
              step="1"
              inputmode="numeric"
              placeholder="本次收到幾元"
              :value="paidTodayAmount === 0 ? '' : paidTodayAmount"
              @input="
                (paidTodayAmount = Math.max(
                  0,
                  Math.trunc(
                    Number.isFinite(($event.target as HTMLInputElement).valueAsNumber)
                      ? ($event.target as HTMLInputElement).valueAsNumber
                      : 0,
                  ),
                ))
              "
            />
            <div class="mt-3">
              <button class="btn-primary w-full" :disabled="loading" @click="receiveCustomerPayment">登記這筆收款</button>
            </div>
          </div>

          <div class="mt-3 rounded-xl border border-slate-200 bg-white p-3">
            <div class="flex items-center justify-between gap-2">
              <div class="text-sm font-bold text-slate-900">目前欠款</div>
              <div class="text-base font-bold tabular-nums" :class="monthlyUnpaidTotal > 0 ? 'text-red-600' : 'text-emerald-700'">
                {{ currency(monthlyUnpaidTotal) }} 元
              </div>
            </div>
            <div class="mt-3">
              <div class="text-sm font-bold text-slate-900">收款紀錄</div>
              <div v-if="paymentRecords.length === 0" class="mt-2 text-sm text-slate-600">尚無收款紀錄</div>
              <div v-else class="mt-2 space-y-2">
                <div v-for="p in paymentRecords" :key="p.id" class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
                  <div class="text-sm font-semibold text-slate-700 tabular-nums">{{ formatBillingDateShort(p.payment_date) }}</div>
                  <div class="text-sm font-bold text-slate-900 tabular-nums">{{ currency(p.amount) }} 元</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <!-- 報價單：卡片 + 區間 -->
        <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-base font-bold tracking-tight text-slate-900">報價單</div>
              <div class="mt-1 text-xs text-slate-500">區間：{{ formatRangeNoYear(quoteFromISO, quoteToISO) }}</div>
            </div>
            <div
              class="rounded-full px-3 py-1 text-sm font-bold"
              :class="monthlyUnpaidTotal > 0 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'"
            >
              未付累積 {{ currency(monthlyUnpaidTotal) }} 元
            </div>
          </div>

          <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div class="text-sm font-bold text-slate-900">查看區間</div>
            <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div class="label mb-1">開始</div>
                <DatePickerField v-model="quoteFromISO" />
              </div>
              <div>
                <div class="label mb-1">結束</div>
                <DatePickerField v-model="quoteToISO" />
              </div>
            </div>
            <p class="mt-2 text-[11px] text-slate-500">預設本月；切換客戶或區間會自動更新。</p>
          </div>

          <div v-if="groupedMonthlyQuotes.length === 0" class="mt-3 text-sm text-slate-600">此區間尚無報價單</div>
          <div v-else class="mt-4 space-y-3">
            <div v-for="q in groupedMonthlyQuotes" :key="q.billingDate" class="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <button
                type="button"
                class="w-full cursor-pointer text-left p-3 transition-colors duration-200 hover:bg-slate-50/80"
                @click="expandedInvoiceDate = expandedInvoiceDate === q.billingDate ? null : q.billingDate"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-base font-bold text-slate-900">{{ formatBillingDateShort(q.billingDate) }}</div>
                    <div class="mt-1 text-sm text-slate-600">{{ q.itemCount }} 項</div>
                  </div>
                  <div class="shrink-0 text-right">
                    <div class="text-sm font-bold tabular-nums" :class="q.currentDebt > 0 ? 'text-red-600' : 'text-emerald-700'">
                      未付 {{ currency(q.currentDebt) }}
                    </div>
                    <div class="mt-1 text-sm font-semibold text-brand-600">
                      {{ expandedInvoiceDate === q.billingDate ? '收合' : '看明細' }}
                    </div>
                  </div>
                </div>
                <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-700">
                  <span class="font-semibold tabular-nums">總 {{ currency(q.totalAmount) }} 元</span>
                  <span class="tabular-nums">已付 {{ currency(q.paidAmount) }} 元</span>
                </div>
              </button>

              <div v-if="expandedInvoiceDate === q.billingDate" class="border-t border-slate-100 bg-slate-50/70 px-3 py-3">
                <div class="text-sm font-bold text-slate-800">品項明細</div>
                <div class="mt-2 space-y-2">
                  <div
                    v-for="d in groupedInvoiceDetails[q.billingDate] ?? []"
                    :key="d.id"
                    class="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0 flex-1">
                        <div class="text-sm font-bold text-slate-900 leading-snug break-words">{{ d.itemName }}</div>
                        <div class="mt-1 text-sm font-semibold text-slate-700">{{ d.specText }}</div>
                      </div>
                      <div class="shrink-0 text-sm font-bold tabular-nums text-slate-900">{{ d.amountText }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="text-xs text-slate-500 px-0.5">同日期已合併為同一張報價單總額。</div>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div class="text-sm font-bold text-slate-900">本月斤數（工資用）</div>
          <p class="mt-1 text-xs text-slate-500">
            統計範圍為行事曆本月（與上方「查看區間」無關）。工資用斤數會將「斤／兩」依 16 兩 = 1 斤換算成小數後加總（可出現半斤等）；其餘秤重報價流程仍為兩 0～15。
          </p>
          <div class="mt-3 overflow-x-auto rounded-lg border border-slate-200">
            <table class="w-full min-w-[240px] text-sm">
              <thead class="bg-slate-50/90 text-left text-slate-600">
                <tr>
                  <th class="py-2 px-3 font-semibold">客戶</th>
                  <th class="py-2 px-3 text-right font-semibold whitespace-nowrap">本月斤數</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in enabledCustomers" :key="c.id" class="border-t border-slate-100">
                  <td class="py-2 px-3 font-medium text-slate-900">{{ c.name }}</td>
                  <td class="py-2 px-3 text-right tabular-nums text-slate-800">
                    {{ formatWageJinDisplay(monthJinByCustomerId[c.id]) }} 斤
                  </td>
                </tr>
              </tbody>
              <tfoot class="border-t-2 border-slate-200 bg-slate-50/70 font-bold text-slate-900">
                <tr>
                  <td class="py-2 px-3">總計</td>
                  <td class="py-2 px-3 text-right tabular-nums">{{ formatWageJinDisplay(monthJinTotalForWage) }} 斤</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

