<script setup>
import { computed } from 'vue'

const props = defineProps({
  message: Object,
  isLast: Boolean,
})

const isUser = computed(() => props.message.role === 'user')
const isLoading = computed(() => props.isLast && props.message.role === 'assistant' && !props.message.content)

// 检测并格式化 JSON
const formattedContent = computed(() => {
  const text = props.message.content
  if (!text) return ''

  // 尝试提取 JSON 块
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim())
      return text.replace(jsonMatch[0], '\n```json\n' + JSON.stringify(parsed, null, 2) + '\n```')
    } catch {}
  }

  // 尝试整段解析为 JSON
  const trimmed = text.trim()
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2)
    } catch {}
  }

  // 尝试提取嵌入的 JSON 对象/数组
  return text.replace(/(\{[\s\S]*?\}|\[[\s\S]*?\])/g, (match) => {
    try {
      const parsed = JSON.parse(match)
      if (typeof parsed === 'object' && parsed !== null) {
        return '\n```json\n' + JSON.stringify(parsed, null, 2) + '\n```'
      }
    } catch {}
    return match
  })
})
</script>

<template>
  <div
    class="flex animate-fade-in"
    :class="isUser ? 'justify-end' : 'justify-start'"
  >
    <div
      class="max-w-[85%] px-4 py-3 rounded-xl text-sm leading-relaxed break-words"
      :class="isUser
        ? 'bg-bg-user-bubble text-text-primary rounded-br-md whitespace-pre-wrap'
        : 'bg-transparent border-l-2 border-accent-start/60 text-text-primary rounded-bl-md pl-4'"
    >
      <template v-if="isLoading">
        <span class="inline-flex gap-1 items-center text-text-muted">
          <span class="w-1.5 h-1.5 rounded-full bg-accent-start animate-pulse" />
          <span class="w-1.5 h-1.5 rounded-full bg-accent-start animate-pulse [animation-delay:0.2s]" />
          <span class="w-1.5 h-1.5 rounded-full bg-accent-start animate-pulse [animation-delay:0.4s]" />
        </span>
      </template>
      <template v-else>
        <div class="content-text whitespace-pre-wrap" v-html="formattedContent" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.content-text :deep(pre) {
  background: #0f0f0f;
  border: 1px solid #2a2a30;
  border-radius: 8px;
  padding: 12px 16px;
  margin: 8px 0;
  overflow-x: auto;
  font-size: 13px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.content-text :deep(code) {
  background: #1e1e2e;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.content-text :deep(pre code) {
  background: transparent;
  padding: 0;
  border-radius: 0;
}

.content-text :deep(strong) {
  color: #e8e8ed;
  font-weight: 600;
}

.content-text :deep(h3) {
  font-size: 14px;
  font-weight: 600;
  margin: 12px 0 4px;
  color: #e8e8ed;
}

.content-text :deep(ul) {
  padding-left: 20px;
  margin: 4px 0;
}

.content-text :deep(li) {
  margin: 2px 0;
}

.content-text :deep(hr) {
  border: none;
  border-top: 1px solid #2a2a30;
  margin: 12px 0;
}
</style>
