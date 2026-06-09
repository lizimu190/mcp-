<script setup>
import { ref } from 'vue'

defineProps({
  loading: Boolean,
})

const emit = defineEmits(['send'])
const input = ref('')

function handleSend() {
  const text = input.value.trim()
  if (!text) return
  emit('send', text)
  input.value = ''
}
</script>

<template>
  <div class="glass border-t border-border-subtle px-8 py-6">
    <div class="flex items-end gap-4">
      <textarea
        v-model="input"
        @keydown.enter.exact.prevent="handleSend"
        :disabled="loading"
        placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
        rows="4"
        class="flex-1 bg-bg-input border border-border-subtle rounded-2xl px-6 py-4 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-start/50 transition-colors duration-200 disabled:opacity-50 resize-none leading-relaxed"
      />
      <button
        @click="handleSend"
        :disabled="loading || !input.trim()"
        class="px-8 py-4 rounded-2xl text-sm font-semibold text-white bg-gradient-to-r from-accent-start to-accent-end hover:opacity-90 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0 shadow-lg shadow-accent-start/20 active:scale-[0.97]"
      >
        发送
      </button>
    </div>
  </div>
</template>
