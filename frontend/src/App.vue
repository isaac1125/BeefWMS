<script setup lang="ts">
import { RouterView } from 'vue-router'
import { onMounted, onUnmounted } from 'vue'
import AppShell from './components/layout/AppShell.vue'

function shouldAllowBackspace(target: EventTarget | null): boolean {
  if (!target) return false
  const el = target as HTMLElement
  if (el.isContentEditable) return true
  if (el.tagName === 'INPUT') return true
  if (el.tagName === 'TEXTAREA') return true
  return false
}

function onGlobalKeyDown(e: KeyboardEvent) {
  // iOS/Safari sometimes navigates history on Backspace when focus is lost.
  if (e.key !== 'Backspace') return
  if (shouldAllowBackspace(e.target)) return
  e.preventDefault()
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeyDown, { capture: true })
})

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeyDown, { capture: true } as any)
})
</script>

<template>
  <AppShell>
    <RouterView />
  </AppShell>
</template>
