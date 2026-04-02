<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { supabase, getCustomerItemPrice } from '../lib/supabase'
import { toISODate } from '../lib/week'
import { jinLiangToTotalLiang, calcAmountByTotalLiang } from '../lib/weight'
import { startOfMonth, endOfMonth } from 'date-fns'
import { useCatalogStore } from '../stores/catalog'
import type { CustomerRow, ItemRow, PickupRow, PickupStatus } from '../types/db'

defineOptions({ name: 'BillingPage' })

const catalog = useCatalogStore()

const loading = ref(false)
const errorMessage = ref<string | null>(null)
const successMessage = ref<string | null>(null)

const todayISO = toISODate(new Date())
const monthStartISO = toISODate(startOfMonth(new Date()))
const monthEndISO = toISODate(endOfMonth(new Date()))

const selectedCustomerId = ref<string | null>(null)
const pendingPickups = ref<PickupRow[]>([])
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
const payDraftByQuoteId = ref<Record<string, number>>({})

const activePickupId = ref<string | null>(null)
const activePrice = ref<{
  pricePerJin: number | null
  pricePerUnit: number | null
  requiresWeighing: boolean
} | null>(null)

const calcWeightJin = ref<number>(0)
const calcWeightLiang = ref<number>(0)
const calcPaidAmount = ref<number>(0)

const activePickup = computed<PickupRow | null>(() => {
  if (!activePickupId.value) return null
  return pendingPickups.value.find((p) => p.id === activePickupId.value) ?? null
})

const activeItem = computed<ItemRow | null>(() => {
  if (!activePickup.value) return null
  return catalog.items.find((i: ItemRow) => i.id === activePickup.value!.item_id) ?? null
})

function currency(n: number): string {
  return (Math.round(n * 100) / 100).toString()
}

const calcTotalAmount = computed(() => {
  if (!activePickup.value || !activePrice.value) return 0
  if (activePrice.value.requiresWeighing) {
    const jin = Math.max(0, Number(calcWeightJin.value ?? 0))
    const liang = Math.max(0, Number(calcWeightLiang.value ?? 0))
    const totalLiang = jinLiangToTotalLiang(jin, liang)
    const p = activePrice.value.pricePerJin
    if (p == null) return 0
    return calcAmountByTotalLiang(totalLiang, p)
  }
  const qty = Math.max(0, Math.trunc(Number(activePickup.value.quantity ?? 0)))
  const unit = activePrice.value.pricePerUnit ?? 0
  return qty * unit
})

const calcDebtAmount = computed(() => {
  const paid = Math.max(0, Number(calcPaidAmount.value ?? 0))
  return Math.max(0, calcTotalAmount.value - paid)
})

const monthlyUnpaidTotal = computed(() => {
  return monthlyQuotes.value.reduce((acc, q) => acc + Number(q.current_debt ?? 0), 0)
})

async function loadPendingPickups(customerId: string) {
  errorMessage.value = null
  successMessage.value = null
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
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to load pickups'
  } finally {
    loading.value = false
  }
}

async function loadMonthlyQuotes(customerId: string) {
  try {
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
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to load monthly quotes'
  }
}

async function openBilling(pickup: PickupRow) {
  activePickupId.value = pickup.id
  calcWeightJin.value = 0
  calcWeightLiang.value = 0
  calcPaidAmount.value = 0

  const price = await getCustomerItemPrice(pickup.customer_id, pickup.item_id)
  activePrice.value = {
    pricePerJin: price.pricePerJin,
    pricePerUnit: price.pricePerUnit,
    requiresWeighing: price.requiresWeighing,
  }
}

async function submitBilling() {
  if (!activePickup.value || !activePrice.value) return
  errorMessage.value = null
  successMessage.value = null
  loading.value = true
  try {
    const paid = Math.max(0, Number(calcPaidAmount.value ?? 0))
    const total = Number(calcTotalAmount.value ?? 0)
    const debt = Math.max(0, total - paid)

    const payload: any = {
      pickup_id: activePickup.value.id,
      customer_id: activePickup.value.customer_id,
      item_id: activePickup.value.item_id,
      total_amount: total,
      paid_amount: paid,
      previous_debt: 0,
      current_debt: debt,
      billing_date: todayISO,
    }

    if (activePrice.value.requiresWeighing) {
      const jin = Math.max(0, Math.trunc(Number(calcWeightJin.value ?? 0)))
      const liang = Math.max(0, Math.trunc(Number(calcWeightLiang.value ?? 0)))
      payload.weight_jin = jin
      payload.weight_liang = liang
    } else {
      payload.weight_jin = null
      payload.weight_liang = null
    }

    const { error: insErr } = await supabase.from('billing_records').insert(payload)
    if (insErr) throw insErr

    const { error: updErr } = await supabase
      .from('pickups')
      .update({ pickup_status: 'billed' as PickupStatus })
      .eq('id', activePickup.value.id)
    if (updErr) throw updErr

    successMessage.value = debt > 0 ? '秤重報價已儲存（尚有未付款）' : '已結帳完成'
    activePickupId.value = null
    activePrice.value = null
    calcWeightJin.value = 0
    calcWeightLiang.value = 0
    calcPaidAmount.value = 0

    if (selectedCustomerId.value) {
      await loadPendingPickups(selectedCustomerId.value)
      await loadMonthlyQuotes(selectedCustomerId.value)
    }
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to submit billing'
  } finally {
    loading.value = false
  }
}

async function receivePayment(quoteId: string) {
  const quote = monthlyQuotes.value.find((q) => q.id === quoteId)
  if (!quote) return
  const payNow = Math.max(0, Number(payDraftByQuoteId.value[quoteId] ?? 0))
  if (payNow <= 0) return

  loading.value = true
  errorMessage.value = null
  successMessage.value = null
  try {
    const nextPaid = Number(quote.paid_amount ?? 0) + payNow
    const cappedPaid = Math.min(nextPaid, Number(quote.total_amount ?? 0))
    const nextDebt = Math.max(0, Number(quote.total_amount ?? 0) - cappedPaid)

    const { error } = await supabase
      .from('billing_records')
      .update({
        paid_amount: cappedPaid,
        current_debt: nextDebt,
      })
      .eq('id', quoteId)

    if (error) throw error
    payDraftByQuoteId.value[quoteId] = 0
    successMessage.value = nextDebt > 0 ? '收款已更新（尚有未付）' : '此單已結清'
    if (selectedCustomerId.value) await loadMonthlyQuotes(selectedCustomerId.value)
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to update payment'
  } finally {
    loading.value = false
  }
}

watch(
  selectedCustomerId,
  (val) => {
    if (val) {
      void loadPendingPickups(val)
      void loadMonthlyQuotes(val)
    }
  },
  { immediate: false },
)

onMounted(async () => {
  if (catalog.customers.length === 0 || catalog.items.length === 0) await catalog.loadAll()
  selectedCustomerId.value = catalog.customers.find((c: CustomerRow) => c.enabled)?.id ?? null
  if (selectedCustomerId.value) {
    await loadPendingPickups(selectedCustomerId.value)
    await loadMonthlyQuotes(selectedCustomerId.value)
  }
})
</script>

<template>
  <div class="p-4">
    <div class="app-card p-4">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-xl font-bold text-slate-900">秤重結帳</h1>
          <div class="mt-1 text-xs text-slate-600">待結帳取貨單（pending）</div>
        </div>
        <div class="text-xs text-slate-600" v-if="loading">處理中...</div>
      </div>

      <div class="mt-4">
        <div class="label mb-1">選客戶</div>
        <select class="field" v-model="selectedCustomerId">
          <option v-for="c in catalog.customers.filter((x) => x.enabled)" :key="c.id" :value="c.id">
            {{ c.name }}
          </option>
        </select>
      </div>

      <div v-if="errorMessage" class="mt-3 text-sm text-red-600">{{ errorMessage }}</div>
      <div v-if="successMessage" class="mt-3 text-sm text-green-700">{{ successMessage }}</div>

      <div class="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div class="rounded-card border border-slate-200 p-3">
          <div class="text-sm font-bold text-slate-900">待秤重取貨單</div>
          <div v-if="pendingPickups.length === 0" class="mt-2 text-sm text-slate-600">
            目前沒有待結帳取貨單
          </div>

          <div v-else class="mt-3 space-y-2">
            <div
              v-for="p in pendingPickups"
              :key="p.id"
              class="rounded-card border border-slate-200 p-2"
              :class="activePickupId === p.id ? 'border-brand-500' : ''"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="text-sm font-bold text-slate-900">
                  {{ catalog.items.find((i: ItemRow) => i.id === p.item_id)?.name ?? 'Unknown' }}
                </div>
                <div class="text-sm font-bold text-brand-600">{{ p.quantity }} 包</div>
              </div>
              <div class="mt-1 flex items-center justify-between gap-3">
                <div class="text-xs text-slate-600">
                  {{
                    catalog.items.find((i: ItemRow) => i.id === p.item_id)?.requires_weighing
                      ? '待秤重'
                      : '按個計價'
                  }}
                </div>
                <button class="btn-ghost px-3 py-2" @click="openBilling(p)">點入秤重</button>
              </div>
            </div>
          </div>
        </div>

        <div class="rounded-card border border-slate-200 p-3" v-if="activePickup">
          <div class="text-sm font-bold text-slate-900">秤重報價表單</div>

          <div class="mt-2 text-xs text-slate-600">
            品項：{{ activeItem?.name ?? 'Unknown' }} / 取貨日期：{{ activePickup.pickup_date }}
          </div>

          <div v-if="activePrice?.requiresWeighing" class="mt-3 space-y-3">
            <div>
              <div class="label mb-1">輸入秤重（斤/兩）</div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <div class="text-xs text-slate-600 mb-1">斤</div>
                  <input class="field" type="number" min="0" step="1" v-model.number="calcWeightJin" />
                </div>
                <div>
                  <div class="text-xs text-slate-600 mb-1">兩（0~15）</div>
                  <input
                    class="field"
                    type="number"
                    min="0"
                    max="15"
                    step="1"
                    v-model.number="calcWeightLiang"
                  />
                </div>
              </div>
            </div>

            <div class="app-card p-3">
              <div class="text-sm font-semibold text-slate-900">✅ 秤重品項</div>
              <div class="mt-2 text-sm text-slate-700">
                你輸入：{{ calcWeightJin }}斤{{ calcWeightLiang }}兩
              </div>
              <div class="text-sm mt-1 text-slate-700">
                總兩數：{{ jinLiangToTotalLiang(calcWeightJin, calcWeightLiang) }}兩
              </div>
              <div class="text-sm mt-1 text-slate-700">
                單價：{{ activePrice?.pricePerJin ?? '-' }} 元/斤
              </div>
              <div class="text-sm mt-2 font-bold text-brand-600">
                總金額：{{ currency(calcTotalAmount) }} 元
              </div>
            </div>
          </div>

          <div v-else class="mt-3 space-y-3">
            <div class="app-card p-3">
              <div class="text-sm font-semibold text-slate-900">✅ 按個品項</div>
              <div class="mt-2 text-sm text-slate-700">
                {{ activePickup.quantity }}個 × 單價（{{ activePrice?.pricePerUnit ?? 0 }} 元/個）=
              </div>
              <div class="text-sm mt-2 font-bold text-brand-600">
                {{ currency(calcTotalAmount) }} 元
              </div>
            </div>
          </div>

          <div class="mt-3">
            <div class="label mb-1">輸入已付金額</div>
            <input class="field" type="number" min="0" step="1" v-model.number="calcPaidAmount" />
          </div>

          <div class="mt-2 text-sm text-slate-700">
            欠款：<span class="font-bold text-red-600">{{ currency(calcDebtAmount) }} 元</span>
          </div>

          <div class="mt-3">
            <button class="btn-primary w-full" :disabled="loading" @click="submitBilling">
              儲存秤重與報價
            </button>
          </div>
        </div>

        <div class="rounded-card border border-slate-200 p-3" v-else>
          <div class="text-sm font-bold text-slate-900">請先點選待結帳清單</div>
          <div class="mt-2 text-sm text-slate-600">左側點入後，右側會顯示對應輸入表單。</div>
        </div>
      </div>

      <div class="mt-4 rounded-card border border-slate-200 p-3">
        <div class="flex items-center justify-between gap-3">
          <div class="text-sm font-bold text-slate-900">本月報價單</div>
          <div class="text-sm font-bold text-red-600">本月未付累積：{{ currency(monthlyUnpaidTotal) }} 元</div>
        </div>
        <div class="mt-2 text-xs text-slate-600">
          區間：{{ monthStartISO }} ~ {{ monthEndISO }}
        </div>

        <div v-if="monthlyQuotes.length === 0" class="mt-3 text-sm text-slate-600">
          本月尚無報價單
        </div>

        <div v-else class="mt-3 space-y-2">
          <div
            v-for="q in monthlyQuotes"
            :key="q.id"
            class="rounded-card border border-slate-200 p-3"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="text-sm font-bold text-slate-900">
                {{ catalog.items.find((i: ItemRow) => i.id === q.item_id)?.name ?? 'Unknown' }}
              </div>
              <div class="text-xs text-slate-600">{{ q.billing_date ?? '-' }}</div>
            </div>

            <div class="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div>總金額：<span class="font-semibold">{{ currency(Number(q.total_amount)) }}</span></div>
              <div>已付：<span class="font-semibold">{{ currency(Number(q.paid_amount)) }}</span></div>
              <div class="col-span-2">
                未付：
                <span class="font-bold" :class="Number(q.current_debt) > 0 ? 'text-red-600' : 'text-green-700'">
                  {{ currency(Number(q.current_debt)) }}
                </span>
              </div>
            </div>

            <div class="mt-2 flex items-center gap-2" v-if="Number(q.current_debt) > 0">
              <input
                class="field"
                type="number"
                min="0"
                step="1"
                :value="payDraftByQuoteId[q.id] ?? 0"
                @input="payDraftByQuoteId[q.id] = Math.max(0, Number(($event.target as HTMLInputElement).value))"
                placeholder="本次收款"
              />
              <button class="btn-primary px-4" @click="receivePayment(q.id)">收款</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

