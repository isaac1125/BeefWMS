<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toISODate } from '../../lib/week'

interface Props {
  modelValue: string
  markedDates?: Set<string>
  placeholder?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const isOpen = ref(false)
const month = ref(new Date(new Date(`${props.modelValue}T00:00:00`).getTime()))

watch(
  () => props.modelValue,
  (v) => {
    if (!v) return
    const d = new Date(`${v}T00:00:00`)
    if (Number.isNaN(d.getTime())) return
    month.value = new Date(d.getFullYear(), d.getMonth(), 1)
  },
  { immediate: true },
)

function buildMonthDays(monthStart: Date): Array<{ iso: string; day: number; isCurrentMonth: boolean }> {
  const y = monthStart.getFullYear()
  const m = monthStart.getMonth()
  const first = new Date(y, m, 1)
  const startOffset = first.getDay() // 0(Sun)~6
  const gridStart = new Date(y, m, 1 - startOffset)
  const days: Array<{ iso: string; day: number; isCurrentMonth: boolean }> = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
    days.push({ iso: toISODate(d), day: d.getDate(), isCurrentMonth: d.getMonth() === m })
  }
  return days
}

const monthDays = computed(() => buildMonthDays(month.value))
const monthLabel = computed(() => {
  const d = month.value
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
})

function prevMonth() {
  const d = month.value
  month.value = new Date(d.getFullYear(), d.getMonth() - 1, 1)
}

function nextMonth() {
  const d = month.value
  month.value = new Date(d.getFullYear(), d.getMonth() + 1, 1)
}

function pickDate(iso: string) {
  emit('update:modelValue', iso)
  isOpen.value = false
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="field w-full min-h-[2.75rem] text-left flex items-center justify-between gap-2"
      @click="isOpen = !isOpen"
    >
      <span class="min-w-0 text-slate-900 tabular-nums whitespace-nowrap">{{ modelValue || placeholder || '請選擇日期' }}</span>
      <span class="text-slate-500">📅</span>
    </button>

    <!-- Desktop: dropdown popover -->
    <div v-if="isOpen" class="hidden sm:block absolute z-[90] mt-2 w-full">
      <div class="rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
        <div class="flex items-center justify-between gap-2">
          <button class="btn-ghost px-3 py-1 bg-white" type="button" @click="prevMonth">上月</button>
          <div class="text-sm font-bold text-slate-900">{{ monthLabel }}</div>
          <button class="btn-ghost px-3 py-1 bg-white" type="button" @click="nextMonth">下月</button>
        </div>

        <div class="mt-3 grid grid-cols-7 gap-1 text-[11px] text-slate-500">
          <div class="text-center">日</div>
          <div class="text-center">一</div>
          <div class="text-center">二</div>
          <div class="text-center">三</div>
          <div class="text-center">四</div>
          <div class="text-center">五</div>
          <div class="text-center">六</div>
        </div>

        <div class="mt-2 grid grid-cols-7 gap-1">
          <button
            v-for="d in monthDays"
            :key="d.iso"
            type="button"
            class="relative h-9 overflow-visible rounded-lg text-sm"
            :class="[
              d.isCurrentMonth ? 'text-slate-900' : 'text-slate-400',
              d.iso === modelValue ? 'bg-brand-100 ring-2 ring-brand-300/50' : 'hover:bg-slate-50',
            ]"
            @click="pickDate(d.iso)"
          >
            <span class="relative z-10 flex h-full items-center justify-center">{{ d.day }}</span>
            <span
              v-if="markedDates?.has(d.iso)"
              class="pointer-events-none absolute bottom-0.5 left-1/2 z-20 h-2 w-2 -translate-x-1/2 rounded-full bg-amber-400 ring-2 ring-white"
            />
          </button>
        </div>
      </div>
    </div>

    <!-- Mobile: compact bottom sheet（不跟著窄欄壓縮） -->
    <div
      v-if="isOpen"
      class="sm:hidden fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/40 px-3 pb-[max(1rem,calc(5.5rem+env(safe-area-inset-bottom)))] pt-10"
      @click.self="isOpen = false"
    >
      <div
        class="w-full max-w-[320px] rounded-xl border border-slate-200 bg-white p-2 shadow-xl overflow-visible mb-10"
        @click.stop
      >
        <div class="flex items-center justify-between gap-1">
          <button class="btn-ghost px-2 py-1 text-xs bg-white" type="button" @click="prevMonth">上月</button>
          <div class="text-xs font-bold text-slate-900">{{ monthLabel }}</div>
          <button class="btn-ghost px-2 py-1 text-xs bg-white" type="button" @click="nextMonth">下月</button>
        </div>

        <div class="mt-2 grid grid-cols-7 gap-px text-[10px] text-slate-500">
          <div class="text-center py-0.5">日</div>
          <div class="text-center py-0.5">一</div>
          <div class="text-center py-0.5">二</div>
          <div class="text-center py-0.5">三</div>
          <div class="text-center py-0.5">四</div>
          <div class="text-center py-0.5">五</div>
          <div class="text-center py-0.5">六</div>
        </div>

        <div class="mt-1 grid grid-cols-7 gap-px">
          <button
            v-for="d in monthDays"
            :key="`m-${d.iso}`"
            type="button"
            class="relative h-8 overflow-visible rounded-md text-xs"
            :class="[
              d.isCurrentMonth ? 'text-slate-900' : 'text-slate-400',
              d.iso === modelValue ? 'bg-brand-100 ring-1 ring-brand-300/60' : 'hover:bg-slate-50',
            ]"
            @click="pickDate(d.iso)"
          >
            <span class="relative z-10 flex h-full items-center justify-center">{{ d.day }}</span>
            <span
              v-if="markedDates?.has(d.iso)"
              class="pointer-events-none absolute bottom-0.5 left-1/2 z-20 h-2 w-2 -translate-x-1/2 rounded-full bg-amber-400 ring-2 ring-white"
            />
          </button>
        </div>

        <button type="button" class="mt-2 w-full py-1.5 text-center text-xs font-semibold text-slate-600" @click="isOpen = false">
          關閉
        </button>
      </div>
    </div>
  </div>
</template>

