<script setup>
import { ref } from 'vue'

defineProps({
  modes: Array,
  activeMode: String,
})

defineEmits(['select', 'clear'])

const expandedId = ref(null)

function toggle(id) {
  expandedId.value = expandedId.value === id ? null : id
}
</script>

<template>
  <aside class="w-[240px] h-screen flex flex-col border-r border-border-subtle bg-bg-sidebar shrink-0">
    <!-- Logo -->
    <div class="px-5 py-5 flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-start to-accent-end flex items-center justify-center shadow-lg shadow-accent-start/20">
        <span class="text-white text-base font-bold">AI</span>
      </div>
      <span class="text-xl font-bold tracking-tight text-text-primary">Console</span>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
      <div v-for="mode in modes" :key="mode.id">
        <!-- 主按钮 -->
        <button
          @click="$emit('select', mode.id); toggle(mode.id)"
          class="w-full flex items-center gap-3.5 px-3.5 py-3 rounded-xl text-sm transition-all duration-200 cursor-pointer group"
          :class="activeMode === mode.id
            ? 'bg-gradient-to-r from-accent-start/15 to-accent-end/10 text-text-primary shadow-sm'
            : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'"
        >
          <span class="text-2xl shrink-0 leading-none">{{ mode.icon }}</span>
          <div class="flex-1 text-left min-w-0">
            <div class="font-semibold truncate">{{ mode.label }}</div>
            <div class="text-[11px] text-text-muted truncate mt-0.5">{{ mode.desc }}</div>
          </div>
          <!-- 展开箭头 -->
          <svg
            class="w-3.5 h-3.5 shrink-0 transition-transform duration-200 text-text-muted"
            :class="{ 'rotate-180': expandedId === mode.id }"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <!-- 下拉功能列表 -->
        <transition name="dropdown">
          <div
            v-if="expandedId === mode.id"
            class="mx-3 mt-1 mb-1 px-3 py-2.5 rounded-lg bg-bg-primary/60 border border-border-subtle"
          >
            <div
              v-for="feat in mode.features"
              :key="feat"
              class="flex items-center gap-2 py-1 text-xs text-text-secondary"
            >
              <span class="w-1 h-1 rounded-full bg-accent-start/70 shrink-0" />
              <span>{{ feat }}</span>
            </div>
          </div>
        </transition>
      </div>
    </nav>

    <!-- 底部清除按钮 -->
    <div class="px-3 pb-5 pt-3 border-t border-border-subtle">
      <button
        @click="$emit('clear')"
        class="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl text-sm font-semibold text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/40 transition-all duration-200 cursor-pointer active:scale-[0.97]"
      >
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        <span>清除记忆</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  max-height: 0;
  transform: translateY(-4px);
}
.dropdown-enter-to,
.dropdown-leave-from {
  opacity: 1;
  max-height: 120px;
}
</style>
