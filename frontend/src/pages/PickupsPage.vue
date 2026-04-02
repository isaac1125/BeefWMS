<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { supabase } from '../lib/supabase'
import { toISODate } from '../lib/week'
import { calcOnHandPackages } from '../lib/stock'
import { useCatalogStore } from '../stores/catalog'
import type { ItemRow } from '../types/db'

defineOptions({ name: 'PickupsPage' })

const catalog = useCatalogStore()

const loading = ref(false)
const errorMessage = ref<string | null>(null)
const successMessage = ref<string | null>(null)
const isSaveModalOpen = ref(false)
const isSavedModalOpen = ref(false)

const defaultPickupDateISO = toISODate(new Date())

const pickupDateISO = ref<string>(defaultPickupDateISO)
const selectedCustomerId = ref<string | null>(null)

// itemId -> packages quantity
const packagesByItemId = ref<Record<string, number>>({})
const originalPendingByItemId = ref<Record<string, number>>({})

const isStockCheckLoading = ref(false)
const stockWarnings = ref<
  Array<{
    itemId: string
    itemName: string
    currentOnHand: number
    delta: number
    projectedOnHand: number
  }>
>([])

const enabledCustomers = computed(() => catalog.customers.filter((c) => c.enabled))
const enabledItems = computed(() => catalog.items.filter((i) => i.enabled))

const saveSummaryRows = computed(() => {
  return enabledItems.value
    .map((it) => {
      const qty = Math.max(0, Math.trunc(Number(packagesByItemId.value[it.id] ?? 0)))
      return { itemId: it.id, itemName: it.name, quantity: qty, hasAny: qty > 0 }
    })
    .filter((r) => r.hasAny)
})

const saveSummaryTotalPackages = computed(() => {
  return saveSummaryRows.value.reduce((sum, r) => sum + r.quantity, 0)
})

function getDefaultQuantity(it: ItemRow): number {
  return Number(packagesByItemId.value[it.id] ?? 0)
}

function setQuantity(itemId: string, raw: number) {
  const n = Number(raw ?? 0)
  const qty = Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0))
  packagesByItemId.value[itemId] = qty
}

async function savePickups() {
  if (!selectedCustomerId.value) {
    errorMessage.value = '請先選擇客戶'
    return
  }
  errorMessage.value = null
  successMessage.value = null
  loading.value = true
  try {
    // 讓同一客戶同一日同一品項可以重送：以 pending 為範圍先刪除再重插
    for (const it of enabledItems.value) {
      const qty = Math.max(0, Math.trunc(Number(packagesByItemId.value[it.id] ?? 0)))

      // delete existing pending
      const { error: delErr } = await supabase
        .from('pickups')
        .delete()
        .eq('customer_id', selectedCustomerId.value)
        .eq('item_id', it.id)
        .eq('pickup_date', pickupDateISO.value)
        .eq('pickup_status', 'pending')
      if (delErr) throw delErr

      if (qty > 0) {
        const { error: insErr } = await supabase.from('pickups').insert({
          customer_id: selectedCustomerId.value,
          item_id: it.id,
          quantity: qty,
          pickup_date: pickupDateISO.value,
          pickup_status: 'pending',
        })
        if (insErr) throw insErr
      }
    }

    successMessage.value = '已儲存取貨登記'
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to save pickups'
  } finally {
    loading.value = false
  }
}

async function computeStockWarningsForSummary() {
  stockWarnings.value = []
  isStockCheckLoading.value = true
  try {
    const targetDateISO = pickupDateISO.value

    // latest inventory snapshot per item up to target date
    const { data: invData, error: invErr } = await supabase
      .from('inventory_records')
      .select('item_id,record_date,current_total')
      .lte('record_date', targetDateISO)
      .order('record_date', { ascending: false })
      .limit(400)
    if (invErr) throw invErr

    const latestInvByItemId = new Map<string, { dateISO: string; baseTotal: number }>()
    ;(invData ?? []).forEach((r: any) => {
      const itemId = r.item_id as string
      if (latestInvByItemId.has(itemId)) return
      latestInvByItemId.set(itemId, {
        dateISO: String(r.record_date),
        baseTotal: Number(r.current_total ?? 0),
      })
    })

    const onHandByItemId = new Map<string, number>()
    await Promise.all(
      enabledItems.value.map(async (it) => {
        const baseInfo = latestInvByItemId.get(it.id)
        if (!baseInfo) {
          onHandByItemId.set(it.id, 0)
          return
        }

        const { data: pData, error: pErr } = await supabase
          .from('pickups')
          .select('quantity')
          .eq('item_id', it.id)
          .gte('pickup_date', baseInfo.dateISO)
          .lte('pickup_date', targetDateISO)
          .in('pickup_status', ['pending', 'billed'])
        if (pErr) throw pErr

        const taken = (pData ?? []).reduce((sum: number, r: any) => sum + Number(r.quantity ?? 0), 0)
        onHandByItemId.set(it.id, calcOnHandPackages(baseInfo.baseTotal, taken))
      }),
    )

    const warnings: Array<{
      itemId: string
      itemName: string
      currentOnHand: number
      delta: number
      projectedOnHand: number
    }> = []

    // use delta to account for editing existing pending rows
    for (const r of saveSummaryRows.value) {
      const currentOnHand = onHandByItemId.get(r.itemId) ?? 0
      const original = Math.max(0, Math.trunc(Number(originalPendingByItemId.value[r.itemId] ?? 0)))
      const draft = Math.max(0, Math.trunc(Number(packagesByItemId.value[r.itemId] ?? 0)))
      const delta = draft - original
      const projectedOnHand = currentOnHand - delta
      if (projectedOnHand < 0) {
        warnings.push({
          itemId: r.itemId,
          itemName: r.itemName,
          currentOnHand,
          delta,
          projectedOnHand,
        })
      }
    }
    stockWarnings.value = warnings
  } finally {
    isStockCheckLoading.value = false
  }
}

function requestSave() {
  errorMessage.value = null
  successMessage.value = null
  if (!selectedCustomerId.value) {
    errorMessage.value = '請先選擇客戶'
    return
  }
  if (saveSummaryRows.value.length === 0) {
    errorMessage.value = '目前沒有任何要存的數字（全部都是 0）'
    return
  }
  isSaveModalOpen.value = true
  void computeStockWarningsForSummary()
}

function clearFormNumbers() {
  const next: Record<string, number> = {}
  for (const it of enabledItems.value) next[it.id] = 0
  packagesByItemId.value = next
}

async function savePickupsConfirmed() {
  isSaveModalOpen.value = false
  await savePickups()
  if (errorMessage.value) return
  clearFormNumbers()
  isSavedModalOpen.value = true
}

async function loadPendingPickupsForForm() {
  if (!selectedCustomerId.value) return
  if (!pickupDateISO.value) return

  loading.value = true
  errorMessage.value = null
  try {
    // init to 0 for all enabled items
    const next: Record<string, number> = {}
    for (const it of enabledItems.value) next[it.id] = 0

    const { data, error } = await supabase
      .from('pickups')
      .select('item_id,quantity')
      .eq('customer_id', selectedCustomerId.value)
      .eq('pickup_date', pickupDateISO.value)
      .eq('pickup_status', 'pending')

    if (error) throw error

    ;(data ?? []).forEach((r: any) => {
      const itemId = r.item_id as string
      const qty = Math.max(0, Math.trunc(Number(r.quantity ?? 0)))
      next[itemId] = qty
    })

    packagesByItemId.value = next
    originalPendingByItemId.value = { ...next }
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to load pickups'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (catalog.customers.length === 0 || catalog.items.length === 0) await catalog.loadAll()
  selectedCustomerId.value = enabledCustomers.value[0]?.id ?? null

  // 初始化輸入值
  for (const it of enabledItems.value) {
    packagesByItemId.value[it.id] = getDefaultQuantity(it)
  }

  await loadPendingPickupsForForm()
})

watch([selectedCustomerId, pickupDateISO], () => {
  void loadPendingPickupsForForm()
})
</script>

<template>
  <div class="p-4 bg-slate-50/70 min-h-full">
    <div
      v-if="isSavedModalOpen"
      class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 p-4"
      @click.self="isSavedModalOpen = false"
    >
      <div class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
        <div class="text-base font-bold text-slate-900">修改完成</div>
        <div class="mt-2 text-sm text-slate-700">已成功儲存取貨登記，表單已清空。</div>
        <div class="mt-4">
          <button class="btn-primary w-full" @click="isSavedModalOpen = false">知道了</button>
        </div>
      </div>
    </div>

    <div
      v-if="isSaveModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      @click.self="isSaveModalOpen = false"
    >
      <div class="w-full max-w-md max-h-[85vh] overflow-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
        <div class="text-base font-bold text-slate-900">存檔摘要</div>
        <div class="mt-2 text-sm text-slate-700">
          客戶：{{ enabledCustomers.find((c) => c.id === selectedCustomerId)?.name ?? '-' }}
        </div>
        <div class="mt-1 text-sm text-slate-700">取貨日期：{{ pickupDateISO }}</div>

        <div v-if="isStockCheckLoading" class="mt-3 text-sm text-slate-600">正在檢查庫存是否會變負數...</div>
        <div
          v-else-if="stockWarnings.length > 0"
          class="mt-3 rounded-xl border border-red-200 bg-red-50 p-3"
        >
          <div class="text-sm font-bold text-red-700">警語：此筆取貨可能造成庫存變負數</div>
          <div class="mt-1 text-xs text-red-700/90">
            仍可存檔（僅提醒你可能需要補入庫或檢查資料）。
          </div>
          <div class="mt-2 space-y-1 text-sm text-red-800">
            <div v-for="w in stockWarnings" :key="w.itemId" class="flex items-center justify-between gap-3">
              <div class="font-semibold truncate">{{ w.itemName }}</div>
              <div class="shrink-0 whitespace-nowrap">
                目前 {{ w.currentOnHand }} → 變更 {{ w.delta >= 0 ? '-' + w.delta : '+' + Math.abs(w.delta) }} = {{ w.projectedOnHand }}
              </div>
            </div>
          </div>
        </div>

        <div class="mt-3 max-h-72 overflow-auto rounded-xl border border-slate-200">
          <table class="w-full text-sm bg-white">
            <thead class="text-left text-slate-500 bg-slate-50/80">
              <tr>
                <th class="py-2 px-3">品項</th>
                <th class="py-2 px-3 text-right">包數</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in saveSummaryRows" :key="r.itemId" class="border-t border-slate-100">
                <td class="py-2 px-3 font-semibold text-slate-900 whitespace-nowrap">{{ r.itemName }}</td>
                <td class="py-2 px-3 text-right font-bold text-slate-900 whitespace-nowrap">{{ r.quantity }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm font-semibold text-slate-700">總包數</div>
            <div class="text-lg font-bold text-slate-900 whitespace-nowrap">{{ saveSummaryTotalPackages }}</div>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-2">
          <button class="btn-ghost w-full bg-white" :disabled="loading" @click="isSaveModalOpen = false">取消</button>
          <button class="btn-primary w-full" :disabled="loading" @click="savePickupsConfirmed">確認存檔</button>
        </div>
      </div>
    </div>

    <div class="mx-auto w-full max-w-3xl space-y-4">
      <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h1 class="text-xl font-bold tracking-tight text-slate-900">取貨登記</h1>
            <div class="mt-1 text-xs text-slate-600">只輸入包數；秤重在「結帳」完成。</div>
          </div>
          <div class="text-xs text-slate-600" v-if="loading">處理中...</div>
        </div>

        <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div class="label mb-1">選客戶</div>
              <select class="field" v-model="selectedCustomerId">
                <option v-for="c in enabledCustomers" :key="c.id" :value="c.id">
                  {{ c.name }}
                </option>
              </select>
            </div>

            <div>
              <div class="label mb-1">取貨日期</div>
              <input class="field" type="date" v-model="pickupDateISO" />
            </div>
          </div>

          <div v-if="errorMessage" class="mt-2 text-sm text-red-600">{{ errorMessage }}</div>
        </div>
      </div>

      <div class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div class="flex items-center justify-between gap-3">
          <div class="text-sm font-bold text-slate-900">品項包數</div>
          <div class="text-xs text-slate-600">未填視為 0 包</div>
        </div>

        <div class="mt-3 space-y-2 md:hidden">
          <div
            v-for="it in enabledItems"
            :key="it.id"
            class="rounded-xl border border-slate-200 bg-white p-3"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="font-bold text-slate-900 truncate">{{ it.name }}</div>
                <div class="mt-1 text-xs text-slate-600">{{ it.requires_weighing ? '後續需秤重' : '按個計價（仍以包數登記）' }}</div>
              </div>
              <div class="text-right shrink-0">
                <div class="text-[11px] text-slate-500 mb-1">包數</div>
                <input
                  class="field w-28 text-right"
                  type="number"
                  inputmode="numeric"
                  min="0"
                  step="1"
                  :value="getDefaultQuantity(it)"
                  @input="setQuantity(it.id, ($event.target as HTMLInputElement).valueAsNumber)"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="mt-3 hidden md:block overflow-x-auto rounded-2xl border border-slate-200">
          <table class="w-full text-sm bg-white">
            <thead class="text-left text-slate-500 bg-slate-50/80">
              <tr>
                <th class="py-3 px-3">品項</th>
                <th class="py-3 px-3">包數</th>
                <th class="py-3 px-3">備註</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="it in enabledItems" :key="it.id" class="border-t border-slate-100">
                <td class="py-3 px-3 font-semibold text-slate-900 whitespace-nowrap">{{ it.name }}</td>
                <td class="py-3 px-3">
                  <input
                    class="field w-32"
                    type="number"
                    inputmode="numeric"
                    min="0"
                    step="1"
                    :value="getDefaultQuantity(it)"
                    @input="setQuantity(it.id, ($event.target as HTMLInputElement).valueAsNumber)"
                  />
                </td>
                <td class="py-3 px-3 text-slate-600 whitespace-nowrap">
                  {{ it.requires_weighing ? '後續需秤重' : '按個計價' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mt-4">
          <button class="btn-primary w-full" :disabled="loading" @click="requestSave">儲存取貨登記</button>
        </div>
      </div>
    </div>
  </div>
</template>

