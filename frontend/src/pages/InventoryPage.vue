<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'

import { supabase } from '../lib/supabase'
import { toISODate } from '../lib/week'
import { calcOnHandPackages } from '../lib/stock'

import { useCatalogStore } from '../stores/catalog'
import type { InventoryRecordRow, ItemRow } from '../types/db'
import DatePickerField from '../components/inputs/DatePickerField.vue'

defineOptions({ name: 'InventoryPage' })

const catalog = useCatalogStore()

const loading = ref(false)
const errorMessage = ref<string | null>(null)
const successMessage = ref<string | null>(null)
const isEditingLastWeek = ref(false)
const isConfirmOpen = ref(false)
const isSavedModalOpen = ref(false)

const today = new Date()
const selectedDateISO = ref(toISODate(today))
const recordDateSet = ref<Set<string>>(new Set())

type InventoryFormRow = {
  lastWeekRemaining: number
  thisWeekInbound: number
}

const formByItemId = ref<Record<string, InventoryFormRow>>({})

const items = computed(() => catalog.items.filter((i) => i.enabled))

const saveSummaryRows = computed(() => {
  return items.value
    .map((it) => {
      const row = formByItemId.value[it.id] ?? { lastWeekRemaining: 0, thisWeekInbound: 0 }
      const previousRemaining = Math.max(0, Math.trunc(Number(row.lastWeekRemaining ?? 0)))
      const currentInbound = Math.max(0, Math.trunc(Number(row.thisWeekInbound ?? 0)))
      const currentTotal = previousRemaining + currentInbound
      return {
        itemId: it.id,
        itemName: it.name,
        previousRemaining,
        currentInbound,
        currentTotal,
        hasAny: previousRemaining !== 0 || currentInbound !== 0,
      }
    })
    .filter((r) => r.hasAny)
})

const saveSummaryTotals = computed(() => {
  const rows = saveSummaryRows.value
  const totalPrevious = rows.reduce((sum, r) => sum + r.previousRemaining, 0)
  const totalInbound = rows.reduce((sum, r) => sum + r.currentInbound, 0)
  const totalCurrent = rows.reduce((sum, r) => sum + r.currentTotal, 0)
  return { totalPrevious, totalInbound, totalCurrent }
})

function getTotal(row: InventoryFormRow): number {
  return Number(row.lastWeekRemaining ?? 0) + Number(row.thisWeekInbound ?? 0)
}

async function loadDate(targetDateISO: string) {
  errorMessage.value = null
  successMessage.value = null
  loading.value = true
  try {
    const { data, error } = await supabase
      .from('inventory_records')
      .select('item_id,previous_remaining,current_inbound,current_total')
      .eq('record_date', targetDateISO)

    if (error) throw error

    const map = new Map<string, InventoryRecordRow>()
    ;(data ?? []).forEach((r: any) => map.set(r.item_id as string, r as InventoryRecordRow))

    const { data: prevData, error: prevErr } = await supabase
      .from('inventory_records')
      .select('item_id,record_date,current_total')
      .lt('record_date', targetDateISO)
      .order('record_date', { ascending: false })
    if (prevErr) throw prevErr
    const prevByItemId = new Map<string, { dateISO: string; baseTotal: number }>()
    ;(prevData ?? []).forEach((r: any) => {
      const itemId = r.item_id as string
      if (prevByItemId.has(itemId)) return
      prevByItemId.set(itemId, {
        dateISO: String(r.record_date),
        baseTotal: Number(r.current_total ?? 0),
      })
    })

    const takenByItemId = new Map<string, number>()
    await Promise.all(
      items.value.map(async (it: ItemRow) => {
        const prev = prevByItemId.get(it.id)
        if (!prev) return
        const { data: pData, error: pErr } = await supabase
          .from('pickups')
          .select('quantity')
          .eq('item_id', it.id)
          .gte('pickup_date', prev.dateISO)
          .lte('pickup_date', targetDateISO)
          .in('pickup_status', ['pending', 'billed'])
        if (pErr) throw pErr
        const taken = (pData ?? []).reduce((sum: number, r: any) => sum + Number(r.quantity ?? 0), 0)
        takenByItemId.set(it.id, taken)
      }),
    )

    const next: Record<string, InventoryFormRow> = {}
    items.value.forEach((it: ItemRow) => {
      const existing = map.get(it.id)
      const prev = prevByItemId.get(it.id)
      const prevBase = prev?.baseTotal ?? 0
      const prevTaken = takenByItemId.get(it.id) ?? 0
      const prevOnHand = prev ? calcOnHandPackages(prevBase, prevTaken) : 0
      next[it.id] = {
        lastWeekRemaining: Number(existing?.previous_remaining ?? prevOnHand),
        thisWeekInbound: Number(existing?.current_inbound ?? 0),
      }
    })
    formByItemId.value = next
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to load inventory'
  } finally {
    loading.value = false
  }
}

function requestSave() {
  errorMessage.value = null
  successMessage.value = null

  if (saveSummaryRows.value.length === 0) {
    errorMessage.value = '目前沒有任何要存的數字（全部都是 0）'
    return
  }
  isConfirmOpen.value = true
}

async function refreshRecordDates() {
  // 取出近期有入庫紀錄的日期，用於日曆上色
  const { data, error } = await supabase
    .from('inventory_records')
    .select('record_date')
    .order('record_date', { ascending: false })
    .limit(400)
  if (error) throw error
  const s = new Set<string>()
  ;(data ?? []).forEach((r: any) => {
    const d = String(r.record_date)
    if (d) s.add(d)
  })
  recordDateSet.value = s
}

async function onPickDate(iso: string) {
  await loadDate(iso)
}

async function saveDateConfirmed() {
  isConfirmOpen.value = false
  errorMessage.value = null
  successMessage.value = null
  loading.value = true
  try {
    const recordDateISO = selectedDateISO.value

    for (const it of items.value) {
      const row = formByItemId.value[it.id]
      const lastRemaining = Math.max(0, Math.trunc(Number(row?.lastWeekRemaining ?? 0)))
      const inbound = Math.max(0, Math.trunc(Number(row?.thisWeekInbound ?? 0)))
      const total = lastRemaining + inbound

      const { data: existing, error: findErr } = await supabase
        .from('inventory_records')
        .select('id')
        .eq('record_date', recordDateISO)
        .eq('item_id', it.id)
        .maybeSingle()

      if (findErr) throw findErr

      if (existing?.id) {
        const { error: updErr } = await supabase
          .from('inventory_records')
          .update({
            previous_remaining: lastRemaining,
            current_inbound: inbound,
            current_total: total,
          })
          .eq('id', existing.id)
        if (updErr) throw updErr
      } else {
        const { error: insErr } = await supabase.from('inventory_records').insert({
          item_id: it.id,
          record_date: recordDateISO,
          previous_remaining: lastRemaining,
          current_inbound: inbound,
          current_total: total,
        })
        if (insErr) throw insErr
      }
    }

    await refreshRecordDates()
    isSavedModalOpen.value = true
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to save inventory'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (catalog.items.length === 0) await catalog.loadAll()
  await loadDate(selectedDateISO.value)
  await refreshRecordDates()
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
        <div class="mt-2 text-sm text-slate-700">已成功存檔。</div>
        <div class="mt-4">
          <button class="btn-primary w-full" @click="isSavedModalOpen = false">知道了</button>
        </div>
      </div>
    </div>

    <div
      v-if="isConfirmOpen"
      class="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-900/40 p-4 pb-[max(1rem,calc(5.5rem+env(safe-area-inset-bottom)))] sm:pb-4"
      @click.self="isConfirmOpen = false"
    >
      <div class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
        <div class="text-base font-bold text-slate-900">存檔摘要</div>
        <div class="mt-2 text-sm text-slate-700">日期：{{ selectedDateISO }}</div>

        <div class="mt-3 max-h-72 overflow-auto rounded-xl border border-slate-200">
          <table class="w-full text-sm bg-white">
            <thead class="text-left text-slate-500 bg-slate-50/80">
              <tr>
                <th class="py-2 px-3">品項</th>
                <th class="py-2 px-3 text-right">上次</th>
                <th class="py-2 px-3 text-right">本次</th>
                <th class="py-2 px-3 text-right">合計</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in saveSummaryRows" :key="r.itemId" class="border-t border-slate-100">
                <td class="py-2 px-3 font-semibold text-slate-900 whitespace-nowrap">{{ r.itemName }}</td>
                <td class="py-2 px-3 text-right text-slate-700 whitespace-nowrap">{{ r.previousRemaining }}</td>
                <td class="py-2 px-3 text-right text-slate-700 whitespace-nowrap">{{ r.currentInbound }}</td>
                <td class="py-2 px-3 text-right font-bold text-slate-900 whitespace-nowrap">{{ r.currentTotal }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-sm text-slate-700">
          <div class="flex items-center justify-between gap-3">
            <div>合計上次</div>
            <div class="font-bold text-slate-900">{{ saveSummaryTotals.totalPrevious }}</div>
          </div>
          <div class="mt-1 flex items-center justify-between gap-3">
            <div>合計本次</div>
            <div class="font-bold text-slate-900">{{ saveSummaryTotals.totalInbound }}</div>
          </div>
          <div class="mt-1 flex items-center justify-between gap-3">
            <div>合計總剩餘</div>
            <div class="font-bold text-slate-900">{{ saveSummaryTotals.totalCurrent }}</div>
          </div>
        </div>

        <div class="mt-3 text-xs text-slate-600">確認存檔後會寫入資料庫。</div>
        <div class="mt-4 grid grid-cols-2 gap-2">
          <button class="btn-ghost w-full bg-white" :disabled="loading" @click="isConfirmOpen = false">取消</button>
          <button class="btn-primary w-full" :disabled="loading" @click="saveDateConfirmed">確認存檔</button>
        </div>
      </div>
    </div>

    <div class="mx-auto w-full max-w-3xl space-y-4">
      <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h1 class="text-xl font-bold tracking-tight text-slate-900">入庫管理</h1>
            <div class="mt-1 text-xs text-slate-600">選日期，輸入上次剩餘 + 本次入庫（包數）</div>
          </div>
          <div class="text-xs text-slate-600" v-if="loading">讀取中...</div>
        </div>

        <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div class="label mb-1">日期</div>
              <DatePickerField v-model="selectedDateISO" :marked-dates="recordDateSet" @update:modelValue="onPickDate" />
              <div class="mt-2 text-xs text-slate-600">
                <span class="inline-flex items-center gap-2">
                  <span class="h-2 w-2 rounded-full bg-brand-500"></span>
                  有入庫資料的日期
                </span>
              </div>
            </div>
          </div>

          <label class="mt-3 flex items-center gap-2 text-sm text-slate-700 select-none">
            <input type="checkbox" class="h-4 w-4" v-model="isEditingLastWeek" />
            手動調整上次剩餘（預設會自動帶目前剩餘）
          </label>

          <div v-if="errorMessage" class="mt-2 text-sm text-red-600">{{ errorMessage }}</div>
        </div>
      </div>

      <div class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div class="flex items-center justify-between gap-3">
          <div class="text-sm font-bold text-slate-900">本次盤點</div>
          <div class="text-xs text-slate-600">所有數值皆為「包」</div>
        </div>

        <div class="mt-3 space-y-2 md:hidden">
          <div v-for="it in items" :key="it.id" class="rounded-xl border border-slate-200 bg-white p-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="font-bold text-slate-900 truncate">{{ it.name }}</div>
              </div>

              <div class="shrink-0 text-right">
                <div class="text-[11px] text-slate-500">本次總剩餘</div>
                <div class="mt-0.5 text-sm font-bold text-slate-900 tabular-nums">
                  {{ getTotal(formByItemId[it.id] ?? { lastWeekRemaining: 0, thisWeekInbound: 0 }) }} 包
                </div>
              </div>
            </div>

            <div class="mt-3 grid grid-cols-2 gap-3">
              <div>
                <div class="text-[11px] text-slate-500 mb-1">上次剩餘（包）</div>
                <input
                  class="field w-full"
                  type="number"
                  inputmode="numeric"
                  min="0"
                  step="1"
                  :disabled="!isEditingLastWeek"
                  :class="!isEditingLastWeek ? 'bg-slate-100 text-slate-700' : ''"
                  :value="(formByItemId[it.id]?.lastWeekRemaining ?? 0) === 0 ? '' : (formByItemId[it.id]?.lastWeekRemaining ?? 0)"
                  @input="
                    formByItemId[it.id].lastWeekRemaining = Math.max(
                      0,
                      Math.trunc(Number(($event.target as HTMLInputElement).value)),
                    )
                  "
                />
              </div>
              <div>
                <div class="text-[11px] text-slate-500 mb-1">本次入庫（包）</div>
                <input
                  class="field w-full"
                  type="number"
                  inputmode="numeric"
                  min="0"
                  step="1"
                  :value="(formByItemId[it.id]?.thisWeekInbound ?? 0) === 0 ? '' : (formByItemId[it.id]?.thisWeekInbound ?? 0)"
                  @input="
                    formByItemId[it.id].thisWeekInbound = Math.max(
                      0,
                      Math.trunc(Number(($event.target as HTMLInputElement).value)),
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
                <th class="py-3 px-3">上次剩餘（包）</th>
                <th class="py-3 px-3">本次入庫（包）</th>
                <th class="py-3 px-3">本次總剩餘（包）</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="it in items" :key="it.id" class="border-t border-slate-100">
                <td class="py-3 px-3 font-semibold text-slate-900 whitespace-nowrap">{{ it.name }}</td>
                <td class="py-3 px-3">
                  <input
                    class="field w-32"
                    type="number"
                    inputmode="numeric"
                    min="0"
                    step="1"
                    :disabled="!isEditingLastWeek"
                    :class="!isEditingLastWeek ? 'bg-slate-100 text-slate-700' : ''"
                    :value="(formByItemId[it.id]?.lastWeekRemaining ?? 0) === 0 ? '' : (formByItemId[it.id]?.lastWeekRemaining ?? 0)"
                    @input="
                      formByItemId[it.id].lastWeekRemaining = Math.max(
                        0,
                        Math.trunc(Number(($event.target as HTMLInputElement).value)),
                      )
                    "
                  />
                </td>
                <td class="py-3 px-3">
                  <input
                    class="field w-32"
                    type="number"
                    inputmode="numeric"
                    min="0"
                    step="1"
                    :value="(formByItemId[it.id]?.thisWeekInbound ?? 0) === 0 ? '' : (formByItemId[it.id]?.thisWeekInbound ?? 0)"
                    @input="
                      formByItemId[it.id].thisWeekInbound = Math.max(
                        0,
                        Math.trunc(Number(($event.target as HTMLInputElement).value)),
                      )
                    "
                  />
                </td>
                <td class="py-3 px-3 font-bold text-slate-900 whitespace-nowrap">
                  {{ getTotal(formByItemId[it.id] ?? { lastWeekRemaining: 0, thisWeekInbound: 0 }) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mt-4">
          <button class="btn-primary w-full" :disabled="loading" @click="requestSave">存檔</button>
        </div>
      </div>
    </div>
  </div>
</template>

