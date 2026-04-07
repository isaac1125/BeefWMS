import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

import { supabase } from '../lib/supabase'
import { toUserErrorMessage } from '../lib/error'
import type { CustomerRow, ItemRow } from '../types/db'
import {
  applyStoredItemOrder,
  isMissingSortOrderColumn,
  readStoredItemOrder,
  writeStoredItemOrder,
} from '../lib/itemOrderStorage'

export const useCatalogStore = defineStore('catalog', () => {
  const customers = ref<CustomerRow[]>([])
  const items = ref<ItemRow[]>([])

  const loading = ref(false)
  const errorMessage = ref<string | null>(null)

  const enabledCustomers = computed(() => customers.value.filter((c) => c.enabled))
  const enabledItems = computed(() => items.value.filter((i) => i.enabled))

  function reorderItemsInPlace(orderIds: string[]) {
    const map = new Map(items.value.map((x) => [x.id, x]))
    const next: ItemRow[] = []
    const seen = new Set<string>()
    for (const id of orderIds) {
      const x = map.get(id)
      if (x) {
        next.push(x)
        seen.add(id)
      }
    }
    for (const it of items.value) {
      if (!seen.has(it.id)) next.push(it)
    }
    items.value = next
  }

  async function loadAll() {
    loading.value = true
    errorMessage.value = null
    try {
      const cRes = await supabase.from('customers').select('id,name,enabled').order('name')
      if (cRes.error) throw cRes.error

      const withSortRes = await supabase
        .from('items')
        .select(
          'id,name,enabled,requires_weighing,default_price_per_jin,default_price_per_unit,sort_order',
        )
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name')

      let rows: ItemRow[]
      if (withSortRes.error && isMissingSortOrderColumn(withSortRes.error)) {
        const noSortRes = await supabase
          .from('items')
          .select('id,name,enabled,requires_weighing,default_price_per_jin,default_price_per_unit')
          .order('name')
        if (noSortRes.error) throw noSortRes.error
        rows = (noSortRes.data ?? []) as ItemRow[]
      } else {
        if (withSortRes.error) throw withSortRes.error
        rows = (withSortRes.data ?? []) as ItemRow[]
      }

      customers.value = (cRes.data ?? []) as CustomerRow[]
      if (readStoredItemOrder()?.length) {
        rows = applyStoredItemOrder(rows)
      }
      items.value = rows
    } catch (e) {
      errorMessage.value = toUserErrorMessage(e, 'Failed to load catalog')
    } finally {
      loading.value = false
    }
  }

  /** 拖拉排序：先寫入本機順序，再嘗試寫入 DB（無 sort_order 欄位時仍可用本機排序） */
  async function persistItemOrder(itemIds: string[]): Promise<{ localOnly: boolean }> {
    writeStoredItemOrder(itemIds)
    reorderItemsInPlace(itemIds)

    let localOnly = false
    for (let i = 0; i < itemIds.length; i++) {
      const { error } = await supabase.from('items').update({ sort_order: i + 1 }).eq('id', itemIds[i])
      if (error) {
        if (isMissingSortOrderColumn(error)) {
          localOnly = true
          break
        }
        throw error
      }
    }
    return { localOnly }
  }

  return {
    customers,
    items,
    loading,
    errorMessage,
    enabledCustomers,
    enabledItems,
    loadAll,
    persistItemOrder,
  }
})
