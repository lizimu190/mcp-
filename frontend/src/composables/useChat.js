import { ref, reactive } from 'vue'

const API_URL = '/api/webhook/agent%20deepseek'

export function useChat(sessionId) {
  const loading = ref(false)

  // 每个 agent 独立对话历史
  const histories = reactive(new Map())

  function initHistory(agentId) {
    if (!histories.has(agentId)) {
      histories.set(agentId, [])
    }
  }

  function getHistory(agentId) {
    initHistory(agentId)
    return histories.get(agentId)
  }

  function clearHistory(agentId) {
    histories.set(agentId, [])
  }

  async function sendMessage(agentId, message) {
    initHistory(agentId)
    const history = histories.get(agentId)

    // 添加用户消息
    history.push({ role: 'user', content: message })

    // 添加 assistant 占位，拿到索引
    const idx = history.length
    history.push({ role: 'assistant', content: '' })

    loading.value = true
    try {
      console.log('[useChat] POST', API_URL, { message, mcp_mode: agentId, sessionId: sessionId.value })

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          mcp_mode: agentId,
          sessionId: sessionId.value,
        }),
      })

      console.log('[useChat] response status:', response.status)
      console.log('[useChat] content-type:', response.headers.get('content-type'))

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()
      console.log('[useChat] response data:', data)

      // n8n 返回格式: [{ "output": "..." }]
      const item = Array.isArray(data) ? data[0] : data
      const text = item.output || item.response || item.message || item.text || JSON.stringify(data)

      // 通过索引赋值，确保 Vue 响应式触发
      history[idx].content = text
      console.log('[useChat] 已赋值:', text.slice(0, 100))
    } catch (e) {
      console.error('[useChat] 错误:', e)
      history[idx].content = `Error: ${e.message}`
    } finally {
      loading.value = false
    }
  }

  async function clearSession(sessionIdRef) {
    loading.value = true
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'clear_session',
          mcp_mode: 'chat',
          sessionId: sessionIdRef.value,
        }),
      })
      const data = await response.json()
      if (data.sessionId) {
        sessionIdRef.value = data.sessionId
        localStorage.setItem('ai_console_sessionId', data.sessionId)
      }
      for (const key of histories.keys()) {
        histories.set(key, [])
      }
      return data
    } catch (e) {
      return { error: e.message }
    } finally {
      loading.value = false
    }
  }

  return { loading, histories, getHistory, clearHistory, sendMessage, clearSession }
}
