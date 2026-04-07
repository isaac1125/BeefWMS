<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { supabase } from '../lib/supabase'
import { useCatalogStore } from '../stores/catalog'
import type { ItemRow } from '../types/db'

defineOptions({ name: 'ItemsPage' })

const catalog = useCatalogStore()

const loading = ref(false)
const errorMessage = ref<string | null>(null)
const successMessage = ref<string | null>(null)

const editingId = ref<string | null>(null)

const draftName = ref('')
const draftEnabled = ref(true)
const draftRequiresWeighing = ref(false)

const draftDefaultPricePerJin = ref<number>(0)
const draftDefaultPricePerUnit = ref<number>(0)

const draggingId = ref<string | null>(null)

async function persistItemSortOrder(nextIds: string[]) {
  loading.value = true
  errorMessage.value = null
  successMessage.value = null
  try {
    const { localOnly } = await catalog.persistItemOrder(nextIds)
    successMessage.value = localOnly
      ? '排序已儲存（本機）。請在 Supabase 執行 migrate_add_items_sort_order.sql，之後會同步到資料庫。'
      : '排序已更新'
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '無法更新排序'
  } finally {
    loading.value = false
  }
}

function onDragStart(id: string) {
  draggingId.value = id
}

function onDropOn(targetId: string) {
  const fromId = draggingId.value
  draggingId.value = null
  if (!fromId || fromId === targetId) return

  const ids = catalog.items.map((x) => x.id)
  const fromIdx = ids.indexOf(fromId)
  const toIdx = ids.indexOf(targetId)
  if (fromIdx < 0 || toIdx < 0) return
  ids.splice(fromIdx, 1)
  ids.splice(toIdx, 0, fromId)
  void persistItemSortOrder(ids)
}

function resetForm() {
  editingId.value = null
  draftName.value = ''
  draftEnabled.value = true
  draftRequiresWeighing.value = false
  draftDefaultPricePerJin.value = 0
  draftDefaultPricePerUnit.value = 0
}

function startEdit(it: ItemRow) {
  editingId.value = it.id
  draftName.value = it.name
  draftEnabled.value = it.enabled
  draftRequiresWeighing.value = it.requires_weighing
  draftDefaultPricePerJin.value = Number(it.default_price_per_jin ?? 0)
  draftDefaultPricePerUnit.value = Number(it.default_price_per_unit ?? 0)
}

async function createItem() {
  if (!draftName.value.trim()) {
    errorMessage.value = '請輸入品項名稱'
    return
  }
  loading.value = true
  errorMessage.value = null
  successMessage.value = null
  try {
    const payload: any = {
      name: draftName.value.trim(),
      enabled: draftEnabled.value,
      requires_weighing: draftRequiresWeighing.value,
      default_price_per_jin: draftRequiresWeighing.value ? draftDefaultPricePerJin.value : null,
      default_price_per_unit: draftRequiresWeighing.value ? null : draftDefaultPricePerUnit.value,
    }

    const { error } = await supabase.from('items').insert(payload)
    if (error) throw error
    successMessage.value = '新增完成'
    await catalog.loadAll()
    resetForm()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to create item'
  } finally {
    loading.value = false
  }
}

async function updateItem() {
  if (!editingId.value) return
  if (!draftName.value.trim()) {
    errorMessage.value = '請輸入品項名稱'
    return
  }
  loading.value = true
  errorMessage.value = null
  successMessage.value = null
  try {
    const payload: any = {
      name: draftName.value.trim(),
      enabled: draftEnabled.value,
      requires_weighing: draftRequiresWeighing.value,
      default_price_per_jin: draftRequiresWeighing.value ? draftDefaultPricePerJin.value : null,
      default_price_per_unit: draftRequiresWeighing.value ? null : draftDefaultPricePerUnit.value,
    }

    const { error } = await supabase.from('items').update(payload).eq('id', editingId.value)
    if (error) throw error
    successMessage.value = '更新完成'
    await catalog.loadAll()
    resetForm()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to update item'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (catalog.items.length === 0) await catalog.loadAll()
})
</script>

<template>
  <div class="p-4">
    <div class="app-card p-4">
      <h1 class="text-xl font-bold text-slate-900">產品維護</h1>
      <div class="mt-1 text-xs text-slate-600">簡單 CRUD（啟用/停用、秤重/按個、預設單價）</div>

      <div class="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div class="rounded-card border border-slate-200 p-3">
          <div class="text-sm font-bold text-slate-900">表單</div>

          <div class="mt-3">
            <div class="label mb-1">品項名稱</div>
            <input class="field" type="text" v-model.trim="draftName" placeholder="例如：小腱" />
          </div>

          <div class="mt-3 flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <input type="checkbox" v-model="draftEnabled" />
              <div class="label mb-0">啟用</div>
            </div>
            <div class="flex items-center gap-2">
              <input type="checkbox" v-model="draftRequiresWeighing" />
              <div class="label mb-0">需要秤重</div>
            </div>
          </div>

          <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div class="label mb-1">預設單價（元/斤）</div>
              <input
                class="field"
                type="number"
                min="0"
                step="1"
                :disabled="!draftRequiresWeighing"
                :class="!draftRequiresWeighing ? 'bg-slate-100 text-slate-700' : ''"
                :value="draftDefaultPricePerJin === 0 ? '' : draftDefaultPricePerJin"
                @input="
                  (draftDefaultPricePerJin = Math.max(
                    0,
                    Math.trunc(
                      Number.isFinite(($event.target as HTMLInputElement).valueAsNumber)
                        ? ($event.target as HTMLInputElement).valueAsNumber
                        : 0,
                    ),
                  ))
                "
              />
            </div>
            <div>
              <div class="label mb-1">預設單價（元/個）</div>
              <input
                class="field"
                type="number"
                min="0"
                step="1"
                :disabled="draftRequiresWeighing"
                :class="draftRequiresWeighing ? 'bg-slate-100 text-slate-700' : ''"
                :value="draftDefaultPricePerUnit === 0 ? '' : draftDefaultPricePerUnit"
                @input="
                  (draftDefaultPricePerUnit = Math.max(
                    0,
                    Math.trunc(
                      Number.isFinite(($event.target as HTMLInputElement).valueAsNumber)
                        ? ($event.target as HTMLInputElement).valueAsNumber
                        : 0,
                    ),
                  ))
                "
              />
            </div>
          </div>

          <div class="mt-4 space-y-2">
            <button class="btn-primary w-full" :disabled="loading" v-if="editingId === null" @click="createItem">
              新增
            </button>
            <button class="btn-primary w-full" :disabled="loading" v-else @click="updateItem">
              更新
            </button>
            <button class="btn-ghost w-full" :disabled="loading" v-if="editingId !== null" @click="resetForm">
              取消
            </button>
          </div>

          <div v-if="errorMessage" class="mt-3 text-sm text-red-600">{{ errorMessage }}</div>
          <div v-if="successMessage" class="mt-3 text-sm text-green-700">{{ successMessage }}</div>
        </div>

        <div class="rounded-card border border-slate-200 p-3">
          <div class="text-sm font-bold text-slate-900">品項列表</div>
          <div class="mt-1 text-xs text-slate-600">可拖拉調整順序（會影響全站顯示順序）</div>
          <div class="mt-3 space-y-2">
            <div
              v-for="it in catalog.items"
              :key="it.id"
              class="rounded-card border border-slate-200 p-2"
              :class="draggingId === it.id ? 'opacity-60' : ''"
              draggable="true"
              @dragstart="onDragStart(it.id)"
              @dragover.prevent
              @drop.prevent="onDropOn(it.id)"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2 min-w-0">
                  <div class="shrink-0 text-slate-400 select-none" title="拖拉排序">≡</div>
                  <div class="min-w-0">
                    <div class="text-sm font-bold text-slate-900 truncate">{{ it.name }}</div>
                    <div class="text-xs text-slate-600">
                      {{ it.requires_weighing ? '秤重' : '按個' }} / {{ it.enabled ? '啟用中' : '已停用' }}
                    </div>
                  </div>
                </div>
                <button class="btn-ghost px-3 py-2" @click="startEdit(it)">編輯</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

