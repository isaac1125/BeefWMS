<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { format, startOfMonth } from 'date-fns'
import { useRouter } from 'vue-router'

import { supabase } from '../lib/supabase'
import { toISODate } from '../lib/week'
import { calcOnHandPackages } from '../lib/stock'
import { toUserErrorMessage } from '../lib/error'
import type { CustomerRow, ItemRow, PickupRow } from '../types/db'
import { useCatalogStore } from '../stores/catalog'

defineOptions({ name: 'DashboardPage' })

const catalog = useCatalogStore()
const router = useRouter()

const loading = ref(false)
const errorMessage = ref<string | null>(null)

const onHandByItemId = ref<Record<string, number>>({})
const debtsByCustomerId = ref<Record<string, number>>({})
const todaysPendingWeighingPickups = ref<PickupRow[]>([])

const pickupDetailRows = ref<PickupRow[]>([])
const detailCustomerId = ref<string | null>(null)
const detailItemId = ref<string | null>(null)
const detailFromISO = ref<string>('')
const detailToISO = ref<string>('')
const expandedDetailOrderKey = ref<string | null>(null)

const today = new Date()
const todayISO = toISODate(today)
const monthStartISO = toISODate(startOfMonth(today))

detailFromISO.value = monthStartISO
detailToISO.value = todayISO

function currency(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return Math.trunc(n) + ''
}

onMounted(async () => {
  loading.value = true
  errorMessage.value = null
  try {
    if (catalog.items.length === 0 || catalog.customers.length === 0) {
      await catalog.loadAll()
    }
    if (catalog.errorMessage) {
      throw new Error(catalog.errorMessage)
    }

    const items = catalog.items
    const customers = catalog.customers

    const [invRes, pickupsRes, billingRes, pendingPickupsRes, detailPickupsRes] = await Promise.all([
      supabase
        .from('inventory_records')
        .select('item_id,current_total,record_date')
        .lte('record_date', todayISO)
        .order('record_date', { ascending: false }),
      supabase
        .from('pickups')
        .select('item_id,quantity,pickup_status,pickup_date')
        .lte('pickup_date', todayISO)
        .in('pickup_status', ['pending', 'billed']),
      supabase.from('billing_records').select('customer_id,current_debt').gt('current_debt', 0),
      supabase
        .from('pickups')
        .select('*')
        .eq('pickup_date', todayISO)
        .eq('pickup_status', 'pending'),
      supabase
        .from('pickups')
        .select('id,customer_id,item_id,quantity,pickup_date,pickup_status')
        .gte('pickup_date', monthStartISO)
        .lte('pickup_date', todayISO)
        .in('pickup_status', ['pending', 'billed'])
        .order('pickup_date', { ascending: false })
        .limit(200),
    ])

    if (invRes.error) throw invRes.error
    if (pickupsRes.error) throw pickupsRes.error
    if (billingRes.error) throw billingRes.error
    if (pendingPickupsRes.error) throw pendingPickupsRes.error
    if (detailPickupsRes.error) throw detailPickupsRes.error

    const latestInvByItemId = new Map<string, { dateISO: string; baseTotal: number }>()
    ;(invRes.data ?? []).forEach((r: any) => {
      const itemId = r.item_id as string
      if (latestInvByItemId.has(itemId)) return
      latestInvByItemId.set(itemId, {
        dateISO: String(r.record_date),
        baseTotal: Number(r.current_total ?? 0),
      })
    })

    const stock: Record<string, number> = {}
    items.forEach((it) => {
      const baseInfo = latestInvByItemId.get(it.id)
      if (!baseInfo) {
        stock[it.id] = 0
        return
      }

      const taken = (pickupsRes.data ?? []).reduce((sum: number, r: any) => {
        if ((r.item_id as string) !== it.id) return sum
        const d = String(r.pickup_date)
        if (d < baseInfo.dateISO) return sum
        return sum + Number(r.quantity ?? 0)
      }, 0)

      stock[it.id] = calcOnHandPackages(baseInfo.baseTotal, taken)
    })
    onHandByItemId.value = stock

    const debts: Record<string, number> = {}
    ;(billingRes.data ?? []).forEach((r: any) => {
      const cid = r.customer_id as string
      const debt = Number(r.current_debt ?? 0)
      debts[cid] = (debts[cid] ?? 0) + debt
    })
    debtsByCustomerId.value = debts

    // 今日待秤重：只顯示 requires_weighing=true 的 pickups
    const itemReqWeighMap = new Map(items.map((i) => [i.id, i.requires_weighing]))
    const list = (pendingPickupsRes.data ?? []) as PickupRow[]
    todaysPendingWeighingPickups.value = list.filter((p) => itemReqWeighMap.get(p.item_id) === true)

    pickupDetailRows.value = (detailPickupsRes.data ?? []) as PickupRow[]

    // 確保所有客戶都有 key（避免模板判斷麻煩）
    customers.forEach((c) => {
      if (debtsByCustomerId.value[c.id] === undefined) debtsByCustomerId.value[c.id] = 0
    })
  } catch (e) {
    errorMessage.value = toUserErrorMessage(e, 'Failed to load dashboard')
  } finally {
    loading.value = false
  }
})

const dateLabel = computed(() => format(today, 'yyyy-MM-dd'))

const filteredDetailRows = computed(() => {
  return pickupDetailRows.value.filter((r) => {
    if (detailCustomerId.value && r.customer_id !== detailCustomerId.value) return false
    if (detailItemId.value && r.item_id !== detailItemId.value) return false
    if (detailFromISO.value && r.pickup_date < detailFromISO.value) return false
    if (detailToISO.value && r.pickup_date > detailToISO.value) return false
    return true
  })
})

const groupedDetailOrders = computed(() => {
  const groups = new Map<
    string,
    {
      key: string
      pickupDate: string
      customerId: string
      itemCount: number
      totalPackages: number
      statusText: string
      detailRows: Array<{ id: string; itemId: string; itemName: string; quantity: number; status: string }>
    }
  >()

  for (const r of filteredDetailRows.value) {
    const pickupDate = r.pickup_date
    const customerId = r.customer_id
    const key = `${pickupDate}__${customerId}`
    const g =
      groups.get(key) ??
      {
        key,
        pickupDate,
        customerId,
        itemCount: 0,
        totalPackages: 0,
        statusText: '',
        detailRows: [],
      }

    g.totalPackages += Math.trunc(Number(r.quantity ?? 0))
    g.detailRows.push({
      id: r.id,
      itemId: r.item_id,
      itemName: getItemName(r.item_id),
      quantity: Math.trunc(Number(r.quantity ?? 0)),
      status: getPickupStatusText(r.pickup_status),
    })

    // unique items count
    const uniq = new Set(g.detailRows.map((x) => x.itemId))
    g.itemCount = uniq.size

    // status summary
    const statusSet = new Set(g.detailRows.map((x) => x.status))
    g.statusText = statusSet.size === 1 ? (Array.from(statusSet)[0] as string) : 'mixed'
    g.statusText = getPickupStatusText(g.statusText)

    groups.set(key, g)
  }

  return Array.from(groups.values()).sort((a, b) => (a.pickupDate < b.pickupDate ? 1 : -1))
})

const groupedPendingWeighingOrders = computed(() => {
  const groups = new Map<
    string,
    {
      key: string
      pickupDate: string
      customerId: string
      itemCount: number
      totalPackages: number
      detailRows: Array<{ id: string; itemId: string; itemName: string; quantity: number }>
    }
  >()

  for (const r of todaysPendingWeighingPickups.value) {
    const pickupDate = r.pickup_date
    const customerId = r.customer_id
    const key = `${pickupDate}__${customerId}`
    const g =
      groups.get(key) ??
      {
        key,
        pickupDate,
        customerId,
        itemCount: 0,
        totalPackages: 0,
        detailRows: [],
      }

    g.totalPackages += Math.trunc(Number(r.quantity ?? 0))
    g.detailRows.push({
      id: r.id,
      itemId: r.item_id,
      itemName: getItemName(r.item_id),
      quantity: Math.trunc(Number(r.quantity ?? 0)),
    })
    g.itemCount = new Set(g.detailRows.map((x) => x.itemId)).size

    groups.set(key, g)
  }

  return Array.from(groups.values()).sort((a, b) => (a.customerId < b.customerId ? -1 : 1))
})

function goBillingForPendingOrder(customerId: string, pickupDate: string) {
  void router.push({
    path: '/billing',
    query: { customerId, orderDate: pickupDate },
  })
}

function getCustomerName(id: string): string {
  return catalog.customers.find((c: CustomerRow) => c.id === id)?.name ?? 'Unknown'
}

function getItemName(id: string): string {
  return catalog.items.find((i: ItemRow) => i.id === id)?.name ?? 'Unknown'
}

function getPickupStatusText(status: string): string {
  if (status === 'pending') return '待秤重'
  if (status === 'billed') return '已報價'
  if (status === 'cancelled') return '已取消'
  if (status === 'mixed') return '混合'
  return status
}
</script>

<template>
  <div class="p-4 bg-slate-50/70 min-h-full">
    <div class="mx-auto w-full max-w-3xl space-y-4">
      <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h1 class="text-xl font-bold tracking-tight text-slate-900">總覽</h1>
            <div class="mt-1 text-xs text-slate-600">今天：{{ dateLabel }}</div>
          </div>
          <div v-if="loading" class="text-xs text-slate-600">讀取中...</div>
          <div v-else-if="errorMessage" class="text-xs text-red-600">{{ errorMessage }}</div>
        </div>

        <div class="mt-4 grid grid-cols-3 gap-2">
          <router-link to="/inventory" class="btn-primary w-full">新增入庫</router-link>
          <router-link to="/pickups" class="btn-primary w-full bg-brand-400 hover:bg-brand-500">登記取貨</router-link>
          <router-link to="/billing" class="btn-primary w-full bg-brand-500 hover:bg-brand-600">秤重結帳</router-link>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm font-bold text-slate-900">各品項庫存</div>
            <div class="text-xs text-slate-600">單位：包</div>
          </div>
          <div class="mt-3 grid grid-cols-4 gap-2">
            <div
              v-for="it in catalog.items.filter((x) => x.enabled)"
              :key="it.id"
              class="rounded-xl border p-2 bg-white"
              :class="(onHandByItemId[it.id] ?? 0) < 10 ? 'border-red-300 bg-red-50/40' : 'border-slate-200'"
            >
              <div class="text-[11px] font-semibold text-slate-700 truncate">{{ it.name }}</div>
              <div
                class="mt-0.5 text-base font-bold"
                :class="(onHandByItemId[it.id] ?? 0) < 10 ? 'text-red-700' : 'text-slate-900'"
              >
                {{ onHandByItemId[it.id] ?? 0 }} 包
              </div>
            </div>
          </div>
          <div class="mt-2 text-[11px] text-slate-500">低於 10 包會標紅提醒。</div>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div class="text-sm font-bold text-slate-900">各客戶欠款總額</div>
          <div class="mt-3 space-y-2">
            <div
              v-for="c in catalog.customers.filter((x) => x.enabled)"
              :key="c.id"
              class="flex items-center justify-between gap-3"
            >
              <div class="text-sm font-semibold text-slate-700">{{ c.name }}</div>
              <div class="text-sm font-bold text-slate-900">{{ currency(debtsByCustomerId[c.id] ?? 0) }} 元</div>
            </div>
          </div>
        </div>
      </div>

      <div class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div class="flex items-center justify-between gap-3">
          <div class="text-sm font-bold text-slate-900">今日待秤重取貨單</div>
          <div class="text-xs text-slate-600">{{ groupedPendingWeighingOrders.length }} 張</div>
        </div>
        <div class="mt-3 space-y-2">
          <div v-if="groupedPendingWeighingOrders.length === 0" class="text-sm text-slate-600">目前沒有待秤重</div>
          <div
            v-for="o in groupedPendingWeighingOrders"
            :key="o.key"
            class="rounded-xl border border-slate-200 bg-white p-3 cursor-pointer transition-colors duration-200 hover:bg-slate-50"
            @click="goBillingForPendingOrder(o.customerId, o.pickupDate)"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="text-xs text-slate-600 whitespace-nowrap">取貨日期：{{ o.pickupDate }}</div>
              <div class="text-sm font-bold text-brand-600 whitespace-nowrap">{{ o.totalPackages }} 包</div>
            </div>
            <div class="mt-1 text-base font-bold text-slate-900 truncate">
              {{ getCustomerName(o.customerId) }}
            </div>
            <div class="mt-1 text-xs text-slate-600 whitespace-nowrap">
              {{ o.itemCount }} 品項・點擊直接去秤重
            </div>
          </div>
        </div>
      </div>

      <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-base font-bold tracking-tight text-slate-900">取貨明細</div>
            <div class="mt-1 text-xs text-slate-600">點客戶看客戶明細；點品項看品項明細。</div>
          </div>
          <div class="text-xs text-slate-600">{{ filteredDetailRows.length }} 筆</div>
        </div>

        <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <div class="label mb-1">客戶</div>
              <select class="field" v-model="detailCustomerId">
                <option :value="null">全部客戶</option>
                <option v-for="c in catalog.customers.filter((x) => x.enabled)" :key="c.id" :value="c.id">
                  {{ c.name }}
                </option>
              </select>
            </div>
            <div>
              <div class="label mb-1">品項</div>
              <select class="field" v-model="detailItemId">
                <option :value="null">全部品項</option>
                <option v-for="it in catalog.items.filter((x) => x.enabled)" :key="it.id" :value="it.id">
                  {{ it.name }}
                </option>
              </select>
            </div>
            <div>
              <div class="label mb-1">起始日</div>
              <input class="field" type="date" v-model="detailFromISO" />
            </div>
            <div>
              <div class="label mb-1">結束日</div>
              <input class="field" type="date" v-model="detailToISO" />
            </div>
          </div>
        </div>

        <div class="mt-3 overflow-x-auto rounded-2xl border border-slate-200">
          <table class="w-full text-sm bg-white">
            <thead class="text-left text-slate-500 bg-slate-50/80">
              <tr>
                <th class="py-3 px-3">日期</th>
                <th class="py-3 px-3">客戶</th>
                <th class="py-3 px-3">品項數</th>
                <th class="py-3 px-3">總包數</th>
                <th class="py-3 px-3">狀態</th>
                <th class="py-3 px-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="o in groupedDetailOrders" :key="o.key">
                <tr class="border-t border-slate-100 hover:bg-slate-50/60">
                  <td class="py-3 px-3 whitespace-nowrap text-slate-700">{{ o.pickupDate }}</td>
                  <td class="py-3 px-3 whitespace-nowrap">
                    <span
                      class="font-semibold text-brand-600 cursor-pointer"
                      @click="detailCustomerId = o.customerId; detailItemId = null"
                    >
                      {{ getCustomerName(o.customerId) }}
                    </span>
                  </td>
                  <td class="py-3 px-3 whitespace-nowrap text-slate-700">{{ o.itemCount }}</td>
                  <td class="py-3 px-3 whitespace-nowrap text-slate-700">{{ o.totalPackages }} 包</td>
                  <td class="py-3 px-3 whitespace-nowrap text-slate-600">{{ o.statusText }}</td>
                  <td class="py-3 px-3 whitespace-nowrap text-right">
                    <button
                      class="btn-ghost px-3 py-1 text-xs bg-white"
                      @click="expandedDetailOrderKey = expandedDetailOrderKey === o.key ? null : o.key"
                    >
                      {{ expandedDetailOrderKey === o.key ? '收合' : '明細' }}
                    </button>
                  </td>
                </tr>

                <tr v-if="expandedDetailOrderKey === o.key" :key="`${o.key}__detail`" class="border-t border-slate-100 bg-slate-50/40">
                  <td class="py-3 px-3" colspan="6">
                    <div class="rounded-xl border border-slate-200 bg-white p-3">
                      <div class="text-sm font-bold text-slate-900">明細</div>
                      <div class="mt-2 overflow-x-auto">
                        <table class="w-full text-sm">
                          <thead class="text-left text-slate-700">
                            <tr>
                              <th class="py-2 pr-2">品項</th>
                              <th class="py-2 pr-2">包數</th>
                              <th class="py-2 pr-2">狀態</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="d in o.detailRows" :key="d.id" class="border-t border-slate-100">
                              <td class="py-2 pr-2 whitespace-nowrap">
                                <span
                                  class="font-semibold text-brand-600 cursor-pointer"
                                  @click="detailItemId = d.itemId; detailCustomerId = null"
                                >
                                  {{ d.itemName }}
                                </span>
                              </td>
                              <td class="py-2 pr-2 whitespace-nowrap text-slate-700">{{ d.quantity }} 包</td>
                              <td class="py-2 pr-2 whitespace-nowrap text-slate-600">{{ d.status }}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <div class="mt-3 text-xs text-slate-500">點表格中的客戶/品項會自動切換上方篩選條件。</div>
      </div>
    </div>
  </div>
</template>

