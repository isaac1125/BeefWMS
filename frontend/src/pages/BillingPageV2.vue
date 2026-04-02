<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { endOfMonth, startOfMonth } from 'date-fns'
import { useRoute } from 'vue-router'

import { supabase, getCustomerItemPrice, type CustomerItemPrice } from '../lib/supabase'
import { toISODate } from '../lib/week'
import { jinLiangToTotalLiang, calcAmountByTotalLiang } from '../lib/weight'
import { useCatalogStore } from '../stores/catalog'
import type { ItemRow, PickupRow } from '../types/db'

defineOptions({ name: 'BillingPageV2' })

const catalog = useCatalogStore()
const route = useRoute()

const loading = ref(false)
const errorMessage = ref<string | null>(null)
const successMessage = ref<string | null>(null)

const todayISO = toISODate(new Date())
const monthStartISO = toISODate(startOfMonth(new Date()))
const monthEndISO = toISODate(endOfMonth(new Date()))

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

// today's payment for the selected order date
const paidTodayAmount = ref<number>(0)
const paymentDateISO = ref<string>(todayISO)

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
  }>
>([])

function currency(n: number): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return '0'
  return Math.trunc(v).toString()
}

const enabledCustomers = computed(() => catalog.customers.filter((c) => c.enabled))

const pendingOrderDates = computed(() => {
  const set = new Set(pendingPickups.value.map((p) => p.pickup_date))
  return Array.from(set.values()).sort((a, b) => (a < b ? 1 : -1))
})

const selectedOrderPickups = computed(() => {
  if (!selectedOrderDate.value) return []
  return pendingPickups.value.filter((p) => p.pickup_date === selectedOrderDate.value)
})

function getItemName(itemId: string): string {
  return catalog.items.find((i: ItemRow) => i.id === itemId)?.name ?? 'Unknown'
}

function getItemById(itemId: string): ItemRow | undefined {
  return catalog.items.find((i: ItemRow) => i.id === itemId)
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

const groupedInvoiceDetails = computed(() => {
  const map: Record<
    string,
    Array<{
      id: string
      itemName: string
      weightText: string
      amountText: string
    }>
  > = {}

  monthlyQuotes.value.forEach((q) => {
    const dateKey = q.billing_date ?? '未設定日期'
    if (!map[dateKey]) map[dateKey] = []

    const hasWeight = q.weight_jin != null || q.weight_liang != null
    const weightText = hasWeight
      ? `${Math.trunc(Number(q.weight_jin ?? 0))}斤${Math.trunc(Number(q.weight_liang ?? 0))}兩`
      : '-'

    map[dateKey].push({
      id: q.id,
      itemName: getItemName(q.item_id),
      weightText,
      amountText: `${currency(q.total_amount)} 元`,
    })
  })

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
    .select('customer_id,weight_jin,billing_date')
    .gte('billing_date', monthStartISO)
    .lte('billing_date', monthEndISO)

  if (error) throw error

  const map: Record<string, number> = {}
  ;(data ?? []).forEach((r: any) => {
    const cid = r.customer_id as string
    const jin = r.weight_jin == null ? 0 : Number(r.weight_jin)
    if (!Number.isFinite(jin)) return
    map[cid] = (map[cid] ?? 0) + jin
  })
  monthJinByCustomerId.value = map
}

async function loadMonthlyQuotes(customerId: string) {
  const { data, error } = await supabase
    .from('billing_records')
    .select(
      'id,pickup_id,customer_id,item_id,weight_jin,weight_liang,total_amount,paid_amount,current_debt,billing_date',
    )
    .eq('customer_id', customerId)
    .gte('billing_date', monthStartISO)
    .lte('billing_date', monthEndISO)
    .order('billing_date', { ascending: false })

  if (error) throw error
  monthlyQuotes.value = (data ?? []) as any
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
    // deterministic allocation order
    const sortedPickups = [...pickups].sort((a, b) => {
      const na = getItemName(a.item_id)
      const nb = getItemName(b.item_id)
      return na.localeCompare(nb)
    })

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
        billing_date: paymentDateISO.value,
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
    await loadMonthlyQuotes(selectedCustomerId.value)
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

    paidTodayAmount.value = 0
    successMessage.value = '已登記收款'
    await loadMonthlyQuotes(selectedCustomerId.value!)
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to update payment'
  } finally {
    loading.value = false
  }
}

watch(selectedCustomerId, (val) => {
  if (!val) return
  void loadPendingPickups(val)
  void loadMonthlyQuotes(val)
})

watch(selectedOrderDate, (val) => {
  if (!val) return
  void loadOrderPricesAndInitWeights()
})

onMounted(async () => {
  if (catalog.customers.length === 0 || catalog.items.length === 0) await catalog.loadAll()
  const qCustomerId = typeof route.query.customerId === 'string' ? route.query.customerId : null
  const qOrderDate = typeof route.query.orderDate === 'string' ? route.query.orderDate : null

  selectedCustomerId.value = qCustomerId && enabledCustomers.value.some((c) => c.id === qCustomerId) ? qCustomerId : (enabledCustomers.value[0]?.id ?? null)

  if (selectedCustomerId.value) {
    await loadMonthJinForAllCustomers()
    await loadPendingPickups(selectedCustomerId.value)
    await loadMonthlyQuotes(selectedCustomerId.value)

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
      class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 p-4"
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
      class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 p-4"
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

            <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div class="label mb-1">收款日期</div>
                <input class="field" type="date" v-model="paymentDateISO" />
              </div>
              <div>
                <div class="label mb-1">收款金額</div>
                <input class="field" type="number" min="0" step="1" v-model.number="paidTodayAmount" />
              </div>
            </div>

            <div class="mt-3">
              <button class="btn-ghost w-full bg-white" :disabled="loading" @click="receiveCustomerPayment">
                登記收款（客戶/日期/金額）
              </button>
            </div>
          </div>
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
            <div
              v-for="p in selectedOrderPickups"
              :key="p.id"
              class="rounded-xl border border-slate-200 bg-white p-3"
            >
              <div class="grid grid-cols-3 gap-2 text-sm">
                <div class="font-bold text-slate-900">{{ getItemName(p.item_id) }}</div>
                <div class="text-slate-700">{{ p.quantity }} 包</div>
                <div class="text-right text-slate-700">{{ getPriceTextForPickup(p) }}</div>
              </div>

              <div class="mt-2 flex items-center justify-between gap-3">
                <div
                  class="flex items-center gap-2 overflow-x-auto whitespace-nowrap [-webkit-overflow-scrolling:touch]"
                >
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

                <div class="flex items-center gap-2 whitespace-nowrap shrink-0">
                  <div class="text-[11px] text-slate-500 whitespace-nowrap">金額</div>
                  <div class="text-base font-bold text-brand-600 whitespace-nowrap">
                    {{ currency(calcPickupTotalAmount(p)) }} 元
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="mt-4">
            <button class="btn-primary w-full" :disabled="loading" @click="requestSubmitSelectedOrderBilling">
              儲存秤重報價
            </button>
          </div>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm" v-else>
          <div class="text-sm font-bold text-slate-900">請先選擇待秤重的日期</div>
        </div>
      </div>

      <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-base font-bold tracking-tight text-slate-900">本月報價單</div>
            <div class="mt-1 text-xs text-slate-500">區間：{{ monthStartISO }} ~ {{ monthEndISO }}</div>
          </div>
          <div
            class="rounded-full px-3 py-1 text-sm font-bold"
            :class="monthlyUnpaidTotal > 0 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'"
          >
            未付累積 {{ currency(monthlyUnpaidTotal) }} 元
          </div>
        </div>

        <div v-if="groupedMonthlyQuotes.length === 0" class="mt-3 text-sm text-slate-600">本月尚無報價單</div>
        <div v-else class="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
          <table class="w-full text-sm bg-white">
            <thead class="text-left text-slate-500 bg-slate-50/80">
              <tr>
                <th class="py-3 px-3">報價單日期</th>
                <th class="py-3 px-3">品項數</th>
                <th class="py-3 px-3">總金額</th>
                <th class="py-3 px-3">已付</th>
                <th class="py-3 px-3">未付</th>
                <th class="py-3 px-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="q in groupedMonthlyQuotes" :key="q.billingDate" class="border-t border-slate-100 hover:bg-slate-50/60">
                <td class="py-3 px-3 whitespace-nowrap font-semibold text-slate-900">{{ q.billingDate }}</td>
                <td class="py-3 px-3 whitespace-nowrap text-slate-700">{{ q.itemCount }}</td>
                <td class="py-3 px-3 whitespace-nowrap text-slate-700">{{ currency(q.totalAmount) }} 元</td>
                <td class="py-3 px-3 whitespace-nowrap text-slate-700">{{ currency(q.paidAmount) }} 元</td>
                <td class="py-3 px-3 whitespace-nowrap font-bold" :class="q.currentDebt > 0 ? 'text-red-600' : 'text-green-700'">
                  {{ currency(q.currentDebt) }} 元
                </td>
                <td class="py-3 px-3 whitespace-nowrap text-right">
                  <button
                    class="btn-ghost px-3 py-1 text-xs bg-white"
                    @click="expandedInvoiceDate = expandedInvoiceDate === q.billingDate ? null : q.billingDate"
                  >
                    {{ expandedInvoiceDate === q.billingDate ? '收合' : '明細' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <div class="px-3 py-2 text-xs text-slate-500 border-t border-slate-100">同日期已合併為同一張報價單總額。</div>

          <div v-if="expandedInvoiceDate" class="m-3 rounded-xl border border-slate-200 p-3 bg-slate-50/60">
            <div class="text-sm font-bold text-slate-900">報價單明細：{{ expandedInvoiceDate }}</div>
            <div class="mt-2 overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="text-left text-slate-700">
                  <tr>
                    <th class="py-2 pr-2">品項</th>
                    <th class="py-2 pr-2">重量</th>
                    <th class="py-2 pr-2">金額</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="d in groupedInvoiceDetails[expandedInvoiceDate] ?? []" :key="d.id" class="border-t border-slate-100">
                    <td class="py-2 pr-2 whitespace-nowrap text-slate-900 font-semibold">{{ d.itemName }}</td>
                    <td class="py-2 pr-2 whitespace-nowrap text-slate-700">{{ d.weightText }}</td>
                    <td class="py-2 pr-2 whitespace-nowrap text-slate-700">{{ d.amountText }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="text-xs text-slate-600 px-1">
        本月斤數（工資用）：
        <span v-for="c in enabledCustomers" :key="c.id" class="mr-3">
          {{ c.name }} {{ monthJinByCustomerId[c.id] ?? 0 }}斤
        </span>
      </div>
    </div>
  </div>
</template>

