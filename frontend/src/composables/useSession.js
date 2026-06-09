import { ref } from 'vue'

const STORAGE_KEY = 'ai_console_sessionId'

function generateId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function useSession() {
  const sessionId = ref(localStorage.getItem(STORAGE_KEY) || generateId())

  function save() {
    localStorage.setItem(STORAGE_KEY, sessionId.value)
  }

  function reset() {
    sessionId.value = generateId()
    save()
  }

  // 初始化时确保存储
  save()

  return { sessionId, reset }
}
