<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()

function isNavActive(path: string, settings = false): boolean {
  return settings ? route.path.startsWith('/settings') : route.path === path
}

function navLinkClass(path: string, settings = false): string {
  const active = isNavActive(path, settings)
  return [
    'flex flex-col items-center justify-center gap-1 rounded-card px-1 py-2.5 text-[15px] font-semibold leading-tight transition-colors sm:text-sm',
    active ? 'bg-brand-500 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-50',
  ].join(' ')
}
</script>

<template>
  <div class="min-h-screen bg-white">
    <header class="px-4 pt-4">
      <div class="app-card flex items-center justify-between p-3">
        <div>
          <div class="text-sm font-bold text-slate-900">大老牛</div>
          <div class="text-xs text-slate-600">庫存管理平台</div>
        </div>
      </div>
    </header>

    <main class="px-4 pb-32">
      <slot />
    </main>

    <nav
      class="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_20px_rgba(0,0,0,0.06)]"
      aria-label="主要導覽"
    >
      <div class="grid grid-cols-4 gap-1 px-2 pt-2 sm:gap-2 sm:px-3 sm:pt-3">
        <router-link
          to="/inventory"
          :class="navLinkClass('/inventory')"
          :aria-current="isNavActive('/inventory') ? 'page' : undefined"
        >
          <svg
            class="h-6 w-6 shrink-0 sm:h-6 sm:w-6"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z"
            />
          </svg>
          <span>入庫</span>
        </router-link>

        <router-link
          to="/pickups"
          :class="navLinkClass('/pickups')"
          :aria-current="isNavActive('/pickups') ? 'page' : undefined"
        >
          <!-- Heroicons 24 outline TruckIcon -->
          <svg
            class="h-6 w-6 shrink-0 sm:h-6 sm:w-6"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12"
            />
          </svg>
          <span>取貨</span>
        </router-link>

        <router-link
          to="/billing"
          :class="navLinkClass('/billing')"
          :aria-current="isNavActive('/billing') ? 'page' : undefined"
        >
          <!-- Heroicons 24 outline BanknotesIcon（現金／鈔票） -->
          <svg
            class="h-6 w-6 shrink-0 sm:h-6 sm:w-6"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z"
            />
          </svg>
          <span>結帳</span>
        </router-link>

        <router-link
          to="/settings"
          :class="navLinkClass('/settings', true)"
          :aria-current="isNavActive('/settings', true) ? 'page' : undefined"
        >
          <!-- Heroicons 24 outline Cog6ToothIcon -->
          <svg
            class="h-6 w-6 shrink-0 sm:h-6 sm:w-6"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
            />
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          <span>設定</span>
        </router-link>
      </div>
    </nav>
  </div>
</template>
