<script setup>
import { computed } from 'vue'

const props = defineProps({
  modes: Array,
  histories: Object, // Map
  activeMode: String,
})

defineEmits(['select', 'delete', 'deleteAll'])

const historyList = computed(() => {
  return props.modes.map(m => {
    const msgs = props.histories?.get?.(m.id) || []
    const userMsgs = msgs.filter(msg => msg.role === 'user')
    return {
      ...m,
      count: userMsgs.length,
      lastMsg: userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content : '',
    }
  })
})

const totalCount = computed(() => historyList.value.reduce((s, i) => s + i.count, 0))
</script>

<template>
  <aside class="w-[280px] h-screen flex flex-col border-l border-border-subtle bg-bg-sidebar shrink-0">
    <!-- 标题 -->
    <div class="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
      <div>
        <h2 class="text-sm font-semibold text-text-primary flex items-center gap-2">
          <svg class="w-4 h-4 text-accent-start" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          对话记录
        </h2>
        <p class="text-[11px] text-text-muted mt-1">各模式独立对话历史</p>
      </div>
      <!-- 一键清空全部 -->
      <button
        v-if="totalCount > 0"
        @click="$emit('deleteAll')"
        class="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 cursor-pointer"
        title="清空所有对话"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>

    <!-- 记录列表 -->
    <div class="flex-1 overflow-y-auto px-3 py-3 space-y-1">
      <div
        v-for="item in historyList"
        :key="item.id"
        class="flex items-center gap-1 group/item"
      >
        <!-- 主内容区 -->
        <button
          @click="$emit('select', item.id)"
          class="flex-1 text-left px-3.5 py-3 rounded-xl transition-all duration-200 cursor-pointer group min-w-0"
          :class="activeMode === item.id
            ? 'bg-gradient-to-r from-accent-start/15 to-accent-end/10 border border-accent-start/20'
            : 'hover:bg-bg-hover border border-transparent'"
        >
          <div class="flex items-center justify-between mb-1.5">
            <div class="flex items-center gap-2">
              <span class="text-lg">{{ item.icon }}</span>
              <span class="text-sm font-medium text-text-primary">{{ item.label }}</span>
            </div>
            <span
              v-if="item.count > 0"
              class="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-start/20 text-accent-start font-medium"
            >
              {{ item.count }}
            </span>
          </div>
          <p v-if="item.lastMsg" class="text-xs text-text-muted truncate pl-7">
            {{ item.lastMsg }}
          </p>
          <p v-else class="text-xs text-text-muted/50 pl-7 italic">
            暂无对话
          </p>
        </button>

        <!-- 单条删除按钮 -->
        <button
          v-if="item.count > 0"
          @click.stop="$emit('delete', item.id)"
          class="p-1.5 rounded-lg text-text-muted opacity-0 group-hover/item:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 cursor-pointer shrink-0"
          title="清除此模式对话"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 底部统计 -->
    <div class="px-5 py-3 border-t border-border-subtle">
      <div class="flex items-center justify-between text-[11px] text-text-muted">
        <span>总消息数</span>
        <span class="font-medium text-text-secondary">{{ totalCount }}</span>
      </div>
    </div>
  </aside>
</template>
