import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

import { supabase } from '../lib/supabase'
import { toUserErrorMessage } from '../lib/error'
import type { CustomerRow, ItemRow } from '../types/db'

export const useCatalogStore = defineStore('catalog', () => {
  const customers = ref<CustomerRow[]>([])
  const items = ref<ItemRow[]>([])

  const loading = ref(false)
  const errorMessage = ref<string | null>(null)

  const enabledCustomers = computed(() => customers.value.filter((c) => c.enabled))
  const enabledItems = computed(() => items.value.filter((i) => i.enabled))

  async function loadAll() {
    // #region agent log
    fetch('http://127.0.0.1:7495/ingest/7f41e303-fdc2-4371-8f32-4fde98da96c9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d5ec67'},body:JSON.stringify({sessionId:'d5ec67',runId:'run1',hypothesisId:'H1',location:'src/stores/catalog.ts:loadAll:start',message:'catalog loadAll start',data:{hasCustomers:customers.value.length,hasItems:items.value.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    loading.value = true
    errorMessage.value = null
    try {
      const [cRes, iRes] = await Promise.all([
        supabase.from('customers').select('id,name,enabled').order('name'),
        supabase
          .from('items')
          .select(
            'id,name,enabled,requires_weighing,default_price_per_jin,default_price_per_unit',
          )
          .order('name'),
      ])

      if (cRes.error) throw cRes.error
      if (iRes.error) throw iRes.error

      customers.value = (cRes.data ?? []) as CustomerRow[]
      items.value = (iRes.data ?? []) as ItemRow[]
      // #region agent log
      fetch('http://127.0.0.1:7495/ingest/7f41e303-fdc2-4371-8f32-4fde98da96c9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d5ec67'},body:JSON.stringify({sessionId:'d5ec67',runId:'run1',hypothesisId:'H1',location:'src/stores/catalog.ts:loadAll:success',message:'catalog loadAll success',data:{customersCount:customers.value.length,itemsCount:items.value.length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    } catch (e) {
      errorMessage.value = toUserErrorMessage(e, 'Failed to load catalog')
      // #region agent log
      fetch('http://127.0.0.1:7495/ingest/7f41e303-fdc2-4371-8f32-4fde98da96c9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d5ec67'},body:JSON.stringify({sessionId:'d5ec67',runId:'run1',hypothesisId:'H1',location:'src/stores/catalog.ts:loadAll:error',message:'catalog loadAll error',data:{errorMessage:errorMessage.value},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    } finally {
      loading.value = false
    }
  }

  return {
    customers,
    items,
    loading,
    errorMessage,
    enabledCustomers,
    enabledItems,
    loadAll,
  }
})

