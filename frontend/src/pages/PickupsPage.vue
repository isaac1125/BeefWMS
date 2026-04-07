<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { endOfMonth, startOfMonth } from 'date-fns'

import { supabase } from '../lib/supabase'
import { toISODate } from '../lib/week'
import { calcOnHandPackages } from '../lib/stock'
import { useCatalogStore } from '../stores/catalog'
import type { ItemRow, PickupRow } from '../types/db'
import DatePickerField from '../components/inputs/DatePickerField.vue'

defineOptions({ name: 'PickupsPage' })

const catalog = useCatalogStore()

const loading = ref(false)
const errorMessage = ref<string | null>(null)
const successMessage = ref<string | null>(null)
const isSaveModalOpen = ref(false)
const isSavedModalOpen = ref(false)
const activeTab = ref<'entry' | 'overview'>('entry')

const defaultPickupDateISO = toISODate(new Date())

const pickupDateISO = ref<string>(defaultPickupDateISO)
/** 近期有取貨紀錄（待秤重／已報價）的日期，供日曆標記 */
const pickupMarkedDateSet = ref<Set<string>>(new Set())
const selectedCustomerId = ref<string | null>(null)

// itemId -> packages quantity
const packagesByItemId = ref<Record<string, number>>({})
/** 進入畫面時載入的數量（含 pending + billed），用於庫存警語與編輯差額 */
const originalLoadedByItemId = ref<Record<string, number>>({})

const isStockCheckLoading = ref(false)
/** 目前載入的取貨是否含已報價（同一客戶/日期） */
const formHasBilledPickup = ref(false)
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

const overviewLoading = ref(false)
const overviewErrorMessage = ref<string | null>(null)
const overviewMonthISO = ref<string>(toISODate(new Date()))
const overviewPickups = ref<PickupRow[]>([])
/** 月底庫存試算：基準（最新入庫 current_total）− 期間取貨 = 剩餘 */
const overviewStockByItemId = ref<Record<string, { base: number; taken: number; remain: number }>>({})
const overviewStockGrand = ref<{ base: number; taken: number; remain: number }>({ base: 0, taken: 0, remain: 0 })

type OverviewCustomerRow = {
  kind: 'customer'
  key: string
  dateISO: string
  customerId: string
  qtyByItemId: Record<string, number>
  rowTotal: number
}

type OverviewDateRow = {
  kind: 'date'
  key: string
  dateISO: string
}

type OverviewRow = OverviewDateRow | OverviewCustomerRow

const overviewRows = computed<OverviewRow[]>(() => {
  const enabledItemIds = new Set(enabledItems.value.map((it) => it.id))
  const byDateCustomer = new Map<string, Map<string, Record<string, number>>>()

  for (const p of overviewPickups.value) {
    const dateISO = String((p as any).pickup_date ?? '')
    const customerId = String((p as any).customer_id ?? '')
    const itemId = String((p as any).item_id ?? '')
    if (!dateISO || !customerId || !itemId) continue
    if (!enabledItemIds.has(itemId)) continue
    const qty = Math.max(0, Math.trunc(Number((p as any).quantity ?? 0)))

    if (!byDateCustomer.has(dateISO)) byDateCustomer.set(dateISO, new Map())
    const byCustomer = byDateCustomer.get(dateISO)!
    if (!byCustomer.has(customerId)) byCustomer.set(customerId, {})
    const qtyByItemId = byCustomer.get(customerId)!
    qtyByItemId[itemId] = (qtyByItemId[itemId] ?? 0) + qty
  }

  const dateISOs = Array.from(byDateCustomer.keys()).sort((a, b) => a.localeCompare(b))
  const rows: OverviewRow[] = []

  for (const dateISO of dateISOs) {
    rows.push({ kind: 'date', key: `d:${dateISO}`, dateISO })
    const byCustomer = byDateCustomer.get(dateISO)!
    const customerIds = Array.from(byCustomer.keys()).sort((a, b) => {
      const an = enabledCustomers.value.find((c) => c.id === a)?.name ?? ''
      const bn = enabledCustomers.value.find((c) => c.id === b)?.name ?? ''
      return an.localeCompare(bn, 'zh-Hant')
    })
    for (const customerId of customerIds) {
      const qtyByItemId = byCustomer.get(customerId) ?? {}
      const rowTotal = Object.values(qtyByItemId).reduce((sum, n) => sum + Number(n ?? 0), 0)
      rows.push({
        kind: 'customer',
        key: `c:${dateISO}:${customerId}`,
        dateISO,
        customerId,
        qtyByItemId,
        rowTotal,
      })
    }
  }

  return rows
})

const overviewTotals = computed(() => {
  const totalsByItemId: Record<string, number> = {}
  for (const it of enabledItems.value) totalsByItemId[it.id] = 0
  let grandTotal = 0

  for (const r of overviewRows.value) {
    if (r.kind !== 'customer') continue
    for (const it of enabledItems.value) {
      const n = Math.max(0, Math.trunc(Number(r.qtyByItemId[it.id] ?? 0)))
      totalsByItemId[it.id] = (totalsByItemId[it.id] ?? 0) + n
    }
    grandTotal += Math.max(0, Math.trunc(Number(r.rowTotal ?? 0)))
  }

  return { totalsByItemId, grandTotal }
})

/** 總覽顯示用「剩餘」：各品項 max(0, 入庫 − 本月小計)；最右「小計」欄為 入庫小計合計 − 本月小計合計（與表首兩列對齊） */
const overviewRemainLedger = computed(() => {
  const byItemId: Record<string, number> = {}
  for (const it of enabledItems.value) {
    const base = overviewStockByItemId.value[it.id]?.base ?? 0
    const m = Math.max(0, Math.trunc(Number(overviewTotals.value.totalsByItemId[it.id] ?? 0)))
    byItemId[it.id] = Math.max(0, Math.trunc(base - m))
  }
  const grand = Math.max(
    0,
    Math.trunc(overviewStockGrand.value.base - overviewTotals.value.grandTotal),
  )
  return { byItemId, grand }
})

const overviewVisibleItemsMobile = computed(() => {
  const totals = overviewTotals.value.totalsByItemId
  const ledger = overviewRemainLedger.value.byItemId
  return enabledItems.value.filter((it) => {
    const m = Math.max(0, Math.trunc(Number(totals[it.id] ?? 0)))
    if (m > 0) return true
    const s = overviewStockByItemId.value[it.id]
    if (!s) return false
    return s.base > 0 || s.taken > 0 || (ledger[it.id] ?? 0) > 0
  })
})

function getCustomerName(customerId: string): string {
  return enabledCustomers.value.find((c) => c.id === customerId)?.name ?? '-'
}

/** 取貨總覽表頭簡稱（與紙本習慣一致） */
function overviewItemShortLabel(it: ItemRow): string {
  const n = String(it.name ?? '').trim()
  if (n.includes('牛筋')) return '筋'
  if (n.includes('牛肚')) return '肚'
  return n
}

const overviewMonthLabel = computed(() => {
  if (!overviewMonthISO.value) return ''
  const d = new Date(`${overviewMonthISO.value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}年${d.getMonth() + 1}月`
})

function shiftOverviewMonth(delta: number) {
  const cur = new Date(`${overviewMonthISO.value}T00:00:00`)
  if (Number.isNaN(cur.getTime())) return
  const y = cur.getFullYear()
  const m = cur.getMonth() + delta
  overviewMonthISO.value = toISODate(new Date(y, m, 1))
}

function formatIsoMonthDay(iso: string): string {
  const parts = String(iso).split('-')
  if (parts.length < 3) return iso
  const m = String(Number(parts[1]))
  const d = String(Number(parts[2]))
  return `${m}/${d}`
}

async function refreshPickupMarkedDates(customerId: string | null) {
  if (!customerId) {
    pickupMarkedDateSet.value = new Set()
    return
  }
  const { data, error } = await supabase
    .from('pickups')
    .select('pickup_date')
    .eq('customer_id', customerId)
    .in('pickup_status', ['pending', 'billed'])
    .order('pickup_date', { ascending: false })
    .limit(500)
  if (error) throw error
  const s = new Set<string>()
  ;(data ?? []).forEach((r: { pickup_date?: string }) => {
    const d = String(r.pickup_date ?? '')
    if (d) s.add(d)
  })
  pickupMarkedDateSet.value = s
}

async function computeOverviewOnHandForMonth(toISO: string) {
  try {
    const targetDateISO = String(toISO)
    if (!targetDateISO) {
      overviewStockByItemId.value = {}
      overviewStockGrand.value = { base: 0, taken: 0, remain: 0 }
      return
    }

    // latest inventory snapshot per item up to month end
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

    const next: Record<string, { base: number; taken: number; remain: number }> = {}
    let gBase = 0
    let gTaken = 0
    let gRemain = 0
    await Promise.all(
      enabledItems.value.map(async (it) => {
        const baseInfo = latestInvByItemId.get(it.id)
        if (!baseInfo) {
          next[it.id] = { base: 0, taken: 0, remain: 0 }
          return
        }

        const base = Math.max(0, Math.trunc(Number(baseInfo.baseTotal ?? 0)))

        const { data: pData, error: pErr } = await supabase
          .from('pickups')
          .select('quantity')
          .eq('item_id', it.id)
          .gte('pickup_date', baseInfo.dateISO)
          .lte('pickup_date', targetDateISO)
          .in('pickup_status', ['pending', 'billed'])
        if (pErr) throw pErr

        const takenRaw = (pData ?? []).reduce((sum: number, r: any) => sum + Number(r.quantity ?? 0), 0)
        const taken = Math.max(0, Math.trunc(Number(takenRaw)))
        const remainRaw = calcOnHandPackages(baseInfo.baseTotal, takenRaw)
        const remain = Math.max(0, Math.trunc(Number(remainRaw ?? 0)))
        next[it.id] = { base, taken, remain }
      }),
    )

    for (const it of enabledItems.value) {
      const row = next[it.id] ?? { base: 0, taken: 0, remain: 0 }
      gBase += row.base
      gTaken += row.taken
      gRemain += row.remain
    }
    overviewStockByItemId.value = next
    overviewStockGrand.value = { base: gBase, taken: gTaken, remain: gRemain }
  } catch {
    overviewStockByItemId.value = {}
    overviewStockGrand.value = { base: 0, taken: 0, remain: 0 }
  }
}

async function loadOverview() {
  overviewErrorMessage.value = null
  overviewLoading.value = true
  try {
    const base = new Date(`${overviewMonthISO.value}T00:00:00`)
    const fromISO = toISODate(startOfMonth(base))
    const toISO = toISODate(endOfMonth(base))

    const { data, error } = await supabase
      .from('pickups')
      .select('id,customer_id,item_id,quantity,pickup_date,pickup_status')
      .gte('pickup_date', fromISO)
      .lte('pickup_date', toISO)
      .in('pickup_status', ['pending', 'billed'])
      .order('pickup_date', { ascending: true })

    if (error) throw error
    overviewPickups.value = (data ?? []) as any
    await computeOverviewOnHandForMonth(toISO)
  } catch (e) {
    overviewErrorMessage.value = e instanceof Error ? e.message : 'Failed to load overview'
  } finally {
    overviewLoading.value = false
  }
}

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
    for (const it of enabledItems.value) {
      const qty = Math.max(0, Math.trunc(Number(packagesByItemId.value[it.id] ?? 0)))

      const { data: rows, error: selErr } = await supabase
        .from('pickups')
        .select('id,pickup_status,quantity')
        .eq('customer_id', selectedCustomerId.value)
        .eq('item_id', it.id)
        .eq('pickup_date', pickupDateISO.value)
        .in('pickup_status', ['pending', 'billed'])

      if (selErr) throw selErr

      const pendingRows = (rows ?? []).filter((r: { pickup_status?: string }) => r.pickup_status === 'pending')
      const billedRows = (rows ?? []).filter((r: { pickup_status?: string }) => r.pickup_status === 'billed')

      if (qty === 0) {
        for (const r of pendingRows) {
          const { error: delErr } = await supabase.from('pickups').delete().eq('id', (r as { id: string }).id)
          if (delErr) throw delErr
        }
        for (const r of billedRows) {
          const { error: updErr } = await supabase
            .from('pickups')
            .update({ quantity: 0, pickup_status: 'cancelled' })
            .eq('id', (r as { id: string }).id)
          if (updErr) throw updErr
        }
        continue
      }

      if (billedRows.length > 0) {
        const keep = billedRows[0] as { id: string }
        for (let i = 1; i < billedRows.length; i++) {
          const { error: delErr } = await supabase
            .from('pickups')
            .delete()
            .eq('id', (billedRows[i] as { id: string }).id)
          if (delErr) throw delErr
        }
        for (const r of pendingRows) {
          const { error: delErr } = await supabase.from('pickups').delete().eq('id', (r as { id: string }).id)
          if (delErr) throw delErr
        }
        const { error: updErr } = await supabase.from('pickups').update({ quantity: qty }).eq('id', keep.id)
        if (updErr) throw updErr
      } else {
        for (const r of pendingRows.slice(1)) {
          const { error: delErr } = await supabase.from('pickups').delete().eq('id', (r as { id: string }).id)
          if (delErr) throw delErr
        }
        if (pendingRows.length > 0) {
          const { error: updErr } = await supabase
            .from('pickups')
            .update({ quantity: qty })
            .eq('id', (pendingRows[0] as { id: string }).id)
          if (updErr) throw updErr
        } else {
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
    const baseInfoByItemId = new Map<string, { dateISO: string; baseTotal: number }>()
    for (const it of enabledItems.value) {
      const baseInfo = latestInvByItemId.get(it.id)
      if (baseInfo) baseInfoByItemId.set(it.id, baseInfo)
      else onHandByItemId.set(it.id, 0)
    }

    const minBaseDateISO = Array.from(baseInfoByItemId.values()).reduce<string | null>((min, v) => {
      if (!min) return v.dateISO
      return v.dateISO < min ? v.dateISO : min
    }, null)

    const pickupRows =
      minBaseDateISO && minBaseDateISO <= targetDateISO
        ? await supabase
            .from('pickups')
            .select('item_id,pickup_date,quantity')
            .gte('pickup_date', minBaseDateISO)
            .lte('pickup_date', targetDateISO)
            .in('pickup_status', ['pending', 'billed'])
        : { data: [], error: null as any }
    if (pickupRows.error) throw pickupRows.error

    const takenByItemId = new Map<string, number>()
    ;(pickupRows.data ?? []).forEach((r: any) => {
      const itemId = String(r.item_id ?? '')
      const baseInfo = baseInfoByItemId.get(itemId)
      if (!baseInfo) return
      const d = String(r.pickup_date ?? '')
      if (!d || d < baseInfo.dateISO) return
      const q = Number(r.quantity ?? 0)
      takenByItemId.set(itemId, (takenByItemId.get(itemId) ?? 0) + q)
    })

    for (const [itemId, baseInfo] of baseInfoByItemId) {
      const taken = takenByItemId.get(itemId) ?? 0
      onHandByItemId.set(itemId, calcOnHandPackages(baseInfo.baseTotal, taken))
    }

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
      const original = Math.max(0, Math.trunc(Number(originalLoadedByItemId.value[r.itemId] ?? 0)))
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

async function savePickupsConfirmed() {
  isSaveModalOpen.value = false
  await savePickups()
  if (errorMessage.value) return
  isSavedModalOpen.value = true
  void refreshPickupMarkedDates(selectedCustomerId.value).catch(() => {})
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
      .select('item_id,quantity,pickup_status')
      .eq('customer_id', selectedCustomerId.value)
      .eq('pickup_date', pickupDateISO.value)
      .in('pickup_status', ['pending', 'billed'])

    if (error) throw error

    formHasBilledPickup.value = (data ?? []).some((r: { pickup_status?: string }) => r.pickup_status === 'billed')

    ;(data ?? []).forEach((r: any) => {
      const itemId = r.item_id as string
      const qty = Math.max(0, Math.trunc(Number(r.quantity ?? 0)))
      next[itemId] = (next[itemId] ?? 0) + qty
    })

    packagesByItemId.value = next
    originalLoadedByItemId.value = { ...next }
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
  await loadOverview()
  try {
    await refreshPickupMarkedDates(selectedCustomerId.value)
  } catch {
    pickupMarkedDateSet.value = new Set()
  }
})

watch([selectedCustomerId, pickupDateISO], () => {
  void loadPendingPickupsForForm()
})

watch(selectedCustomerId, (id) => {
  void refreshPickupMarkedDates(id).catch(() => {
    pickupMarkedDateSet.value = new Set()
  })
})

watch([activeTab, overviewMonthISO], () => {
  if (activeTab.value !== 'overview') return
  void loadOverview()
})
</script>

<template>
  <div class="p-4 bg-slate-50/70 min-h-full">
    <div
      v-if="isSavedModalOpen"
      class="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-900/40 p-4 pb-[max(1rem,calc(5.5rem+env(safe-area-inset-bottom)))] sm:pb-4"
      @click.self="isSavedModalOpen = false"
    >
      <div class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
        <div class="text-base font-bold text-slate-900">修改完成</div>
        <div class="mt-2 text-sm text-slate-700">已成功儲存取貨登記。</div>
        <div class="mt-4">
          <button class="btn-primary w-full" @click="isSavedModalOpen = false">知道了</button>
        </div>
      </div>
    </div>

    <div
      v-if="isSaveModalOpen"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 max-sm:pb-[max(1rem,calc(5.5rem+env(safe-area-inset-bottom)))]"
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
      <div class="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            class="rounded-xl px-3 py-2 text-sm font-semibold"
            :class="activeTab === 'entry' ? 'bg-brand-100 text-slate-900' : 'bg-white text-slate-700 hover:bg-slate-50'"
            @click="activeTab = 'entry'"
          >
            取貨登記
          </button>
          <button
            type="button"
            class="rounded-xl px-3 py-2 text-sm font-semibold"
            :class="
              activeTab === 'overview' ? 'bg-brand-100 text-slate-900' : 'bg-white text-slate-700 hover:bg-slate-50'
            "
            @click="activeTab = 'overview'"
          >
            總覽
          </button>
        </div>
      </div>

      <template v-if="activeTab === 'entry'">
        <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h1 class="text-xl font-bold tracking-tight text-slate-900">取貨登記</h1>
              <div class="mt-1 text-xs text-slate-600">只輸入包數；秤重在「結帳」完成。</div>
            </div>
            <div class="text-xs text-slate-600" v-if="loading">處理中...</div>
          </div>

          <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
              <div class="min-w-0">
                <div class="label mb-1">選客戶</div>
                <select class="field w-full" v-model="selectedCustomerId">
                  <option v-for="c in enabledCustomers" :key="c.id" :value="c.id">
                    {{ c.name }}
                  </option>
                </select>
              </div>

              <div class="min-w-0">
                <div class="label mb-1">取貨日期</div>
                <DatePickerField v-model="pickupDateISO" :marked-dates="pickupMarkedDateSet" />
              </div>
            </div>

            <div v-if="errorMessage" class="mt-2 text-sm text-red-600">{{ errorMessage }}</div>
            <div
              v-if="formHasBilledPickup"
              class="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5"
            >
              此日期已有「已報價」取貨資料；儲存會一併更新數量（改為 0 將取消該筆取貨）。
            </div>
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
                  <div class="mt-1 text-xs text-slate-600">
                    {{ it.requires_weighing ? '後續需秤重' : '按個計價（仍以包數登記）' }}
                  </div>
                </div>
                <div class="text-right shrink-0">
                  <div class="text-[11px] text-slate-500 mb-1">包數</div>
                  <input
                    class="field w-28 text-right"
                    type="number"
                    inputmode="numeric"
                    min="0"
                    step="1"
                    :value="getDefaultQuantity(it) === 0 ? '' : getDefaultQuantity(it)"
                    @input="
                      setQuantity(
                        it.id,
                        Number.isFinite(($event.target as HTMLInputElement).valueAsNumber)
                          ? ($event.target as HTMLInputElement).valueAsNumber
                          : 0,
                      )
                    "
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
                      :value="getDefaultQuantity(it) === 0 ? '' : getDefaultQuantity(it)"
                      @input="
                        setQuantity(
                          it.id,
                          Number.isFinite(($event.target as HTMLInputElement).valueAsNumber)
                            ? ($event.target as HTMLInputElement).valueAsNumber
                            : 0,
                        )
                      "
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
      </template>

      <template v-else>
        <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h1 class="text-xl font-bold tracking-tight text-slate-900">取貨總覽</h1>
              <div class="mt-1 text-xs text-slate-600">依月份彙整（只含「待秤重 / 已報價」）</div>
            </div>
            <div class="text-xs text-slate-600" v-if="overviewLoading">讀取中...</div>
          </div>

          <div class="mt-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div class="text-sm font-bold text-slate-900">目前剩餘庫存（各品項）</div>
            <p class="mt-1 text-[10px] leading-relaxed text-slate-500">
              <strong>入庫 − 本月小計</strong>（表內同欄相減，不低於 0）；與表尾「剩餘」列相同。
            </p>
            <div class="mt-3 grid grid-cols-4 gap-2">
              <div
                v-for="it in enabledItems"
                :key="`onhand-${it.id}`"
                class="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2"
              >
                <div class="text-[11px] text-slate-600 truncate" :title="it.name">{{ overviewItemShortLabel(it) }}</div>
                <div class="mt-0.5 text-lg font-bold tabular-nums text-brand-700">
                  {{ overviewRemainLedger.byItemId[it.id] ?? 0 }}
                </div>
              </div>
            </div>
          </div>

          <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div class="label mb-2">月份</div>
            <div class="flex items-center justify-between gap-2">
              <button
                type="button"
                class="btn-ghost shrink-0 px-3 py-2 text-sm font-semibold bg-white"
                :disabled="overviewLoading"
                @click="shiftOverviewMonth(-1)"
              >
                上月
              </button>
              <div class="min-w-0 flex-1 text-center text-base font-bold text-slate-900 tabular-nums">
                {{ overviewMonthLabel }}
              </div>
              <button
                type="button"
                class="btn-ghost shrink-0 px-3 py-2 text-sm font-semibold bg-white"
                :disabled="overviewLoading"
                @click="shiftOverviewMonth(1)"
              >
                下月
              </button>
            </div>
            <div class="mt-3">
              <button class="btn-ghost w-full bg-white" :disabled="overviewLoading" @click="loadOverview">重新整理</button>
            </div>

            <div v-if="overviewErrorMessage" class="mt-2 text-sm text-red-600">{{ overviewErrorMessage }}</div>
          </div>

          <p class="mt-3 text-[11px] leading-relaxed text-slate-500">
            表首<strong>入庫</strong>為最新入庫基準量；中間為本月取貨明細；表尾<strong>本月小計</strong>為該月加總；最底<strong>剩餘</strong>為<strong>入庫 − 本月小計</strong>（與上方卡片一致）。
          </p>
        </div>

        <!-- 取貨明細表：入庫 → 明細 → 本月小計 → 剩餘（手機橫向捲動，避免 table-fixed 裁切） -->
        <div
          class="rounded-2xl border border-slate-200 bg-white -mx-1 overflow-x-auto overscroll-x-contain [scrollbar-gutter:stable] sm:mx-0"
        >
          <table
            class="w-full min-w-[32rem] border-collapse text-[11px] md:min-w-0 md:table-fixed md:text-[12px]"
          >
            <thead class="text-left text-slate-500 bg-amber-100/70">
              <tr>
                <th class="py-2 px-2 md:py-3 md:px-3 whitespace-nowrap md:w-[76px]">日期</th>
                <th class="py-2 px-2 md:py-3 md:px-3 whitespace-nowrap md:w-[92px]">客戶</th>
                <th
                  v-for="it in enabledItems"
                  :key="`h-${it.id}`"
                  class="py-2 px-1.5 md:py-3 md:px-2 text-center font-semibold text-slate-700 min-w-[2.25rem] md:min-w-0"
                  :class="{
                    hidden: overviewVisibleItemsMobile.length > 0 && !overviewVisibleItemsMobile.some((x) => x.id === it.id),
                    'md:table-cell': true,
                  }"
                  :title="it.name"
                >
                  <span class="block text-center leading-tight break-words">{{ overviewItemShortLabel(it) }}</span>
                </th>
                <th class="py-2 px-2 md:py-3 md:px-3 text-right whitespace-nowrap md:w-[64px]">小計</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-t border-amber-200/80 bg-amber-50/80">
                <td colspan="2" class="py-1.5 px-2 md:py-2 md:px-3 font-bold text-slate-800 whitespace-nowrap">入庫</td>
                <td
                  v-for="it in enabledItems"
                  :key="`sb-${it.id}`"
                  class="py-1.5 px-1.5 md:py-2 md:px-2 text-right tabular-nums text-slate-900 font-semibold"
                  :class="{
                    hidden: overviewVisibleItemsMobile.length > 0 && !overviewVisibleItemsMobile.some((x) => x.id === it.id),
                    'md:table-cell': true,
                  }"
                >
                  {{ overviewStockByItemId[it.id]?.base ?? 0 }}
                </td>
                <td class="py-1.5 px-2 md:py-2 md:px-3 text-right font-bold tabular-nums text-slate-900">
                  {{ overviewStockGrand.base }}
                </td>
              </tr>

              <tr v-if="overviewRows.length === 0" class="border-t border-slate-100 bg-slate-50/40">
                <td class="py-6 px-3 text-slate-600" :colspan="3 + enabledItems.length">本月尚無取貨資料</td>
              </tr>

              <template v-for="r in overviewRows" :key="r.key">
                <tr v-if="r.kind === 'date'" class="border-t border-slate-200 bg-white">
                  <td class="py-2 px-2 md:px-3 font-bold text-slate-900 whitespace-nowrap">{{ formatIsoMonthDay(r.dateISO) }}</td>
                  <td class="py-2 px-2 md:px-3 text-slate-500" :colspan="2 + enabledItems.length"> </td>
                </tr>

                <tr v-else class="border-t border-slate-100 hover:bg-slate-50/60">
                  <td class="py-2 px-2 md:py-3 md:px-3 text-slate-700 whitespace-nowrap"></td>
                  <td class="py-2 px-2 md:py-3 md:px-3 font-semibold text-slate-900 whitespace-nowrap">
                    {{ getCustomerName(r.customerId) }}
                  </td>
                  <td
                    v-for="it in enabledItems"
                    :key="`d-${r.key}-${it.id}`"
                    class="py-2 px-1.5 md:py-3 md:px-2 text-right text-slate-700 tabular-nums"
                    :class="{
                      hidden: overviewVisibleItemsMobile.length > 0 && !overviewVisibleItemsMobile.some((x) => x.id === it.id),
                      'md:table-cell': true,
                    }"
                  >
                    {{ Math.max(0, Math.trunc(Number(r.qtyByItemId[it.id] ?? 0))) || '' }}
                  </td>
                  <td class="py-2 px-2 md:py-3 md:px-3 text-right font-bold text-slate-900 tabular-nums">
                    {{ r.rowTotal || '' }}
                  </td>
                </tr>
              </template>
            </tbody>
            <tfoot class="bg-slate-50/80 text-slate-600">
              <tr class="border-t border-slate-200">
                <td class="py-2 px-2 md:py-3 md:px-3 font-bold text-slate-900 whitespace-nowrap">
                  <span class="md:hidden">月計</span>
                  <span class="hidden md:inline">本月小計</span>
                </td>
                <td class="py-2 px-2 md:py-3 md:px-3"></td>
                <td
                  v-for="it in enabledItems"
                  :key="`t-${it.id}`"
                  class="py-2 px-1.5 md:py-3 md:px-2 text-right font-bold text-slate-900 tabular-nums"
                  :class="{
                    hidden: overviewVisibleItemsMobile.length > 0 && !overviewVisibleItemsMobile.some((x) => x.id === it.id),
                    'md:table-cell': true,
                  }"
                >
                  {{ overviewTotals.totalsByItemId[it.id] || '' }}
                </td>
                <td class="py-2 px-2 md:py-3 md:px-3 text-right font-bold text-slate-900 tabular-nums">
                  {{ overviewTotals.grandTotal || '' }}
                </td>
              </tr>
              <tr class="border-t border-slate-200 bg-emerald-50/60">
                <td colspan="2" class="py-2 px-2 md:py-3 md:px-3 font-bold text-brand-800 whitespace-nowrap">剩餘</td>
                <td
                  v-for="it in enabledItems"
                  :key="`rem-ft-${it.id}`"
                  class="py-2 px-1.5 md:py-3 md:px-2 text-right font-bold tabular-nums text-brand-700"
                  :class="{
                    hidden: overviewVisibleItemsMobile.length > 0 && !overviewVisibleItemsMobile.some((x) => x.id === it.id),
                    'md:table-cell': true,
                  }"
                >
                  {{ overviewRemainLedger.byItemId[it.id] ?? 0 }}
                </td>
                <td class="py-2 px-2 md:py-3 md:px-3 text-right font-bold tabular-nums text-brand-700">
                  {{ overviewRemainLedger.grand }}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </template>
    </div>
  </div>
</template>

