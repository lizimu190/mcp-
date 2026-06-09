<script setup>
import { ref } from 'vue'
import Sidebar from './components/Sidebar.vue'
import ChatWindow from './components/ChatWindow.vue'
import ChatHistory from './components/ChatHistory.vue'
import { useSession } from './composables/useSession.js'
import { useChat } from './composables/useChat.js'

const agentModes = [
  { id: 'Filesystem',       label: 'Filesystem',       icon: '📂', desc: '文件系统读写与管理', features: ['读写文件', '目录遍历', '搜索替换'] },
  { id: 'Data_Transform',   label: 'Data_Transform',   icon: '📊', desc: '数据解析与格式转换', features: ['CSV/Excel', 'JSON/XML', 'PDF解析'] },
  { id: 'Web_Overview',     label: 'Web_Overview',     icon: '🌐', desc: '网页交互与信息提取', features: ['页面概览', '内容提取', '链接解析'] },
  { id: 'System_Control',   label: 'System_Control',   icon: '⚙️', desc: '终端命令与系统控制', features: ['执行命令', '进程管理', '端口检测'] },
  { id: 'Code_Interpreter', label: 'Code_Interpreter', icon: '🐍', desc: 'Python 代码执行沙盒', features: ['代码执行', 'REPL交互', '图表生成'] },
  { id: 'Memory_System',    label: 'Memory_System',    icon: '🧠', desc: '记忆管理与状态存储', features: ['键值存储', '语义搜索', '上下文压缩'] },
]

const { sessionId, reset } = useSession()
const { loading, histories, getHistory, clearHistory, sendMessage, clearSession } = useChat(sessionId)

const activeMode = ref(agentModes[0].id)

function handleSend(message) {
  sendMessage(activeMode.value, message)
}

async function handleClear() {
  await clearSession(sessionId)
}
</script>

<template>
  <div class="flex h-screen overflow-hidden">
    <!-- 左侧导航 -->
    <Sidebar
      :modes="agentModes"
      :active-mode="activeMode"
      @select="activeMode = $event"
      @clear="handleClear"
    />

    <!-- 中间对话区 -->
    <ChatWindow
      :mode="agentModes.find(m => m.id === activeMode)"
      :messages="getHistory(activeMode)"
      :loading="loading"
      @send="handleSend"
    />

    <!-- 右侧对话记录 -->
    <ChatHistory
      :modes="agentModes"
      :histories="histories"
      :active-mode="activeMode"
      @select="activeMode = $event"
      @delete="clearHistory($event)"
      @delete-all="agentModes.forEach(m => clearHistory(m.id))"
    />
  </div>
</template>
