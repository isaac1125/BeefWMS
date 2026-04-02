<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { supabase } from '../lib/supabase'
import { useCatalogStore } from '../stores/catalog'
import type { CustomerRow } from '../types/db'

defineOptions({ name: 'CustomersPage' })

const catalog = useCatalogStore()

const loading = ref(false)
const errorMessage = ref<string | null>(null)
const successMessage = ref<string | null>(null)

const draftName = ref('')
const draftEnabled = ref(true)

const editingId = ref<string | null>(null)

function resetForm() {
  editingId.value = null
  draftName.value = ''
  draftEnabled.value = true
}

async function createCustomer() {
  if (!draftName.value.trim()) {
    errorMessage.value = '請輸入客戶名稱'
    return
  }
  loading.value = true
  errorMessage.value = null
  successMessage.value = null
  try {
    const { error } = await supabase.from('customers').insert({
      name: draftName.value.trim(),
      enabled: draftEnabled.value,
    })
    if (error) throw error
    successMessage.value = '新增完成'
    await catalog.loadAll()
    resetForm()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to create customer'
  } finally {
    loading.value = false
  }
}

async function updateCustomer() {
  if (!editingId.value) return
  if (!draftName.value.trim()) {
    errorMessage.value = '請輸入客戶名稱'
    return
  }
  loading.value = true
  errorMessage.value = null
  successMessage.value = null
  try {
    const { error } = await supabase
      .from('customers')
      .update({ name: draftName.value.trim(), enabled: draftEnabled.value })
      .eq('id', editingId.value)
    if (error) throw error
    successMessage.value = '更新完成'
    await catalog.loadAll()
    resetForm()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to update customer'
  } finally {
    loading.value = false
  }
}

function startEdit(c: CustomerRow) {
  editingId.value = c.id
  draftName.value = c.name
  draftEnabled.value = c.enabled
}

onMounted(async () => {
  if (catalog.customers.length === 0) await catalog.loadAll()
})
</script>

<template>
  <div class="p-4">
    <div class="app-card p-4">
      <h1 class="text-xl font-bold text-slate-900">客戶維護</h1>
      <div class="mt-1 text-xs text-slate-600">簡單 CRUD（新增/編輯/停用）</div>

      <div class="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div class="rounded-card border border-slate-200 p-3">
          <div class="text-sm font-bold text-slate-900">表單</div>
          <div class="mt-3">
            <div class="label mb-1">客戶名稱</div>
            <input class="field" type="text" v-model.trim="draftName" placeholder="例如：寶春" />
          </div>
          <div class="mt-3 flex items-center justify-between gap-3">
            <div>
              <div class="label mb-1">啟用</div>
              <input type="checkbox" v-model="draftEnabled" />
            </div>
            <button class="btn-ghost" :disabled="loading" v-if="editingId" @click="resetForm">
              取消
            </button>
          </div>

          <div class="mt-4 space-y-2">
            <button class="btn-primary w-full" :disabled="loading" v-if="editingId === null" @click="createCustomer">
              新增
            </button>
            <button class="btn-primary w-full" :disabled="loading" v-else @click="updateCustomer">
              更新
            </button>
          </div>

          <div v-if="errorMessage" class="mt-3 text-sm text-red-600">{{ errorMessage }}</div>
          <div v-if="successMessage" class="mt-3 text-sm text-green-700">{{ successMessage }}</div>
        </div>

        <div class="rounded-card border border-slate-200 p-3">
          <div class="text-sm font-bold text-slate-900">客戶列表</div>
          <div class="mt-3 space-y-2">
            <div
              v-for="c in catalog.customers"
              :key="c.id"
              class="rounded-card border border-slate-200 p-2"
            >
              <div class="flex items-center justify-between gap-3">
                <div>
                  <div class="text-sm font-bold text-slate-900">{{ c.name }}</div>
                  <div class="text-xs text-slate-600">{{ c.enabled ? '啟用中' : '已停用' }}</div>
                </div>
                <button class="btn-ghost px-3 py-2" @click="startEdit(c)">
                  編輯
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

