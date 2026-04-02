<script setup lang="ts">
import { useRoute } from 'vue-router'

defineOptions({ name: 'SettingsPage' })

const route = useRoute()

function isActive(path: string): boolean {
  return route.path === path
}
</script>

<template>
  <div class="p-4">
    <div class="app-card p-4">
      <h1 class="text-xl font-bold text-slate-900">設定</h1>
      <div class="mt-1 text-xs text-slate-600">定價、客戶、品項維護</div>

      <div class="mt-4 grid grid-cols-3 gap-2">
        <router-link
          to="/settings/pricing"
          class="text-center text-sm font-semibold py-2 rounded-card border"
          :class="
            isActive('/settings/pricing')
              ? 'bg-brand-500 text-white border-brand-500'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          "
        >
          定價
        </router-link>
        <router-link
          to="/settings/customers"
          class="text-center text-sm font-semibold py-2 rounded-card border"
          :class="
            isActive('/settings/customers')
              ? 'bg-brand-500 text-white border-brand-500'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          "
        >
          客戶
        </router-link>
        <router-link
          to="/settings/items"
          class="text-center text-sm font-semibold py-2 rounded-card border"
          :class="
            isActive('/settings/items')
              ? 'bg-brand-500 text-white border-brand-500'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          "
        >
          品項
        </router-link>
      </div>
    </div>

    <router-view />
  </div>
</template>

