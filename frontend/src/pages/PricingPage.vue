<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { useCatalogStore } from '../stores/catalog'
import type { CustomerRow, ItemRow } from '../types/db'

defineOptions({ name: 'PricingPage' })

const catalog = useCatalogStore()

const loading = ref(false)
const errorMessage = ref<string | null>(null)
const successMessage = ref<string | null>(null)

const selectedCustomerId = ref<string | null>(null)

const priceDraftByItemId = ref<Record<string, number>>({})

const items = computed(() => catalog.items.filter((i: ItemRow) => i.enabled))

function getUnitText(it: ItemRow): string {
  return it.requires_weighing ? '元/斤' : '元/個'
}

async function loadPricing(customerId: string) {
  errorMessage.value = null
  successMessage.value = null
  loading.value = true
  try {
    const { data: prices, error } = await supabase
      .from('customer_item_prices')
      .select('item_id,price_per_jin,price_per_unit')
      .eq('customer_id', customerId)
    if (error) throw error

    const map = new Map<string, { price_per_jin: number | null; price_per_unit: number | null }>()
    ;(prices ?? []).forEach((r: any) =>
      map.set(r.item_id as string, {
        price_per_jin: r.price_per_jin ?? null,
        price_per_unit: r.price_per_unit ?? null,
      }),
    )

    const next: Record<string, number> = {}
    items.value.forEach((it: ItemRow) => {
      const row = map.get(it.id)
      if (it.requires_weighing) {
        next[it.id] =
          row?.price_per_jin != null
            ? Number(row.price_per_jin)
            : Number(it.default_price_per_jin ?? 0)
      } else {
        next[it.id] =
          row?.price_per_unit != null
            ? Number(row.price_per_unit)
            : Number(it.default_price_per_unit ?? 0)
      }
    })

    priceDraftByItemId.value = next
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to load pricing'
  } finally {
    loading.value = false
  }
}

async function savePricing() {
  if (!selectedCustomerId.value) return
  errorMessage.value = null
  successMessage.value = null
  loading.value = true
  try {
    const rows = items.value.map((it: ItemRow) => {
      const v = Math.max(0, Number(priceDraftByItemId.value[it.id] ?? 0))
      if (it.requires_weighing) {
        return {
          customer_id: selectedCustomerId.value,
          item_id: it.id,
          price_per_jin: v,
          price_per_unit: null,
        }
      }
      return {
        customer_id: selectedCustomerId.value,
        item_id: it.id,
        price_per_jin: null,
        price_per_unit: v,
      }
    })

    const { error } = await supabase
      .from('customer_item_prices')
      .upsert(rows as any, { onConflict: 'customer_id,item_id' })
    if (error) throw error

    successMessage.value = '定價已保存'
    await loadPricing(selectedCustomerId.value)
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to save pricing'
  } finally {
    loading.value = false
  }
}

watch(selectedCustomerId, (val) => {
  if (val) void loadPricing(val)
})

onMounted(async () => {
  if (catalog.customers.length === 0 || catalog.items.length === 0) await catalog.loadAll()
  selectedCustomerId.value = catalog.customers.find((c: CustomerRow) => c.enabled)?.id ?? null
  if (selectedCustomerId.value) await loadPricing(selectedCustomerId.value)
})
</script>

<template>
  <div class="p-4">
    <div class="app-card p-4">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-xl font-bold text-slate-900">定價維護</h1>
          <div class="mt-1 text-xs text-slate-600">
            每個客戶對每品項都有獨立單價（不使用折扣倍率）。
          </div>
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

      <div class="mt-4">
        <div class="text-sm font-bold text-slate-900">品項單價表</div>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-slate-700">
              <tr>
                <th class="py-2 pr-2">品項</th>
                <th class="py-2 pr-2">單價</th>
                <th class="py-2 pr-2">單位</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="it in items" :key="it.id">
                <td class="py-2 pr-2 font-semibold text-slate-900">{{ it.name }}</td>
                <td class="py-2 pr-2">
                  <input
                    class="field"
                    type="number"
                    min="0"
                    step="1"
                    :value="priceDraftByItemId[it.id] ?? 0"
                    @input="
                      priceDraftByItemId[it.id] = Math.max(
                        0,
                        Math.trunc(Number(($event.target as HTMLInputElement).value)),
                      )
                    "
                  />
                </td>
                <td class="py-2 pr-2 text-slate-600">{{ getUnitText(it) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="mt-4">
        <button class="btn-primary w-full" :disabled="loading" @click="savePricing">一鍵保存</button>
      </div>
    </div>
  </div>
</template>

