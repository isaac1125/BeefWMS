<script setup lang="ts">
import { useRoute } from 'vue-router'
import CowIllustration from '../illustrations/CowIllustration.vue'

const route = useRoute()
</script>

<template>
  <div class="min-h-screen bg-white">
    <header class="px-4 pt-4">
      <div class="app-card p-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="w-10 h-10 rounded-card bg-brand-500/10 flex items-center justify-center">
            <CowIllustration />
          </div>
          <div>
            <div class="text-sm font-bold text-slate-900">大老牛滷</div>
            <div class="text-xs text-slate-600">庫存管理平台</div>
          </div>
        </div>
      </div>
    </header>

    <main class="px-4 pb-24">
      <slot />
    </main>

    <nav class="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200">
      <div class="grid grid-cols-5 gap-2 p-3">
        <router-link
          to="/"
          class="text-center text-xs font-semibold py-2 rounded-card"
          :class="route.path === '/' ? 'bg-brand-500 text-white' : 'text-slate-700 hover:bg-slate-50'"
        >
          總覽
        </router-link>
        <router-link
          to="/inventory"
          class="text-center text-xs font-semibold py-2 rounded-card"
          :class="route.path === '/inventory' ? 'bg-brand-500 text-white' : 'text-slate-700 hover:bg-slate-50'"
        >
          入庫
        </router-link>
        <router-link
          to="/pickups"
          class="text-center text-xs font-semibold py-2 rounded-card"
          :class="route.path === '/pickups' ? 'bg-brand-500 text-white' : 'text-slate-700 hover:bg-slate-50'"
        >
          取貨
        </router-link>
        <router-link
          to="/billing"
          class="text-center text-xs font-semibold py-2 rounded-card"
          :class="route.path === '/billing' ? 'bg-brand-500 text-white' : 'text-slate-700 hover:bg-slate-50'"
        >
          結帳
        </router-link>
        <router-link
          to="/settings"
          class="text-center text-xs font-semibold py-2 rounded-card"
          :class="route.path.startsWith('/settings') ? 'bg-brand-500 text-white' : 'text-slate-700 hover:bg-slate-50'"
        >
          設定
        </router-link>
      </div>
    </nav>
  </div>
</template>

