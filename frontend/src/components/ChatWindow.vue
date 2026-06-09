<script setup>
import { ref, watch, nextTick } from 'vue'
import MessageBubble from './MessageBubble.vue'
import InputBar from './InputBar.vue'

const props = defineProps({
  mode: Object,
  messages: Array,
  loading: Boolean,
})

defineEmits(['send'])

const listRef = ref(null)

watch(() => props.messages.length, async () => {
  await nextTick()
  if (listRef.value) {
    listRef.value.scrollTop = listRef.value.scrollHeight
  }
})

// 监听最后一条消息内容变化（流式更新时滚动）
watch(() => {
  const msgs = props.messages
  return msgs.length > 0 ? msgs[msgs.length - 1].content : ''
}, async () => {
  await nextTick()
  if (listRef.value) {
    listRef.value.scrollTop = listRef.value.scrollHeight
  }
})
</script>

<template>
  <main class="flex-1 flex flex-col h-screen bg-bg-content min-w-0">
    <!-- 顶栏 -->
    <header class="flex items-center gap-3 px-6 py-4 border-b border-border-subtle shrink-0">
      <span class="text-xl">{{ mode?.icon }}</span>
      <div>
        <h1 class="text-sm font-semibold text-text-primary">{{ mode?.label }}</h1>
        <p class="text-xs text-text-muted">{{ mode?.desc }}</p>
      </div>
    </header>

    <!-- 消息列表 -->
    <div ref="listRef" class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
      <!-- 空状态 -->
      <div v-if="messages.length === 0" class="flex items-center justify-center h-full">
        <div class="text-center space-y-3">
          <div class="text-4xl">{{ mode?.icon }}</div>
          <p class="text-text-muted text-sm">开始与 {{ mode?.label }} 对话</p>
        </div>
      </div>

      <!-- 消息 -->
      <MessageBubble
        v-for="(msg, i) in messages"
        :key="i"
        :message="msg"
        :is-last="i === messages.length - 1"
      />
    </div>

    <!-- 输入框 -->
    <InputBar :loading="loading" @send="$emit('send', $event)" />
  </main>
</template>
