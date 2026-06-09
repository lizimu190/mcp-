 # MCP 本地智能体系统

  基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io) 的本地 AI
  智能体系统，通过自然语言操控计算机、处理文件、查阅网页并执行代码。前端 Vue 3 聊天界面 + MCP Server 集群 + n8n
  工作流编排，实现 6 大能力模块的统一调度。

  ## 系统架构

  ┌─────────────────────────────────────────────────────┐
  │                   Vue 3 前端 (Vite)                  │
  │         侧边栏模式切换 │ 聊天窗口 │ 历史记录          │
  └──────────────────────┬──────────────────────────────┘
                         │ HTTP (localhost:5173 → proxy)
                         ▼
  ┌─────────────────────────────────────────────────────┐
  │                  n8n 工作流中间层                      │
  │            AI Agent + DeepSeek 模型编排               │
  └──────────────────────┬──────────────────────────────┘
                         │ MCP Protocol (SSE / Streamable HTTP)
                         ▼
  ┌─────────────────────────────────────────────────────┐
  │              MCP Server 路由器 (:3000)               │
  │         统一 Session 管理 │ 跨模式批量调用             │
  ├──────┬──────┬──────┬──────┬──────┬──────┐           │
  │:3001 │:3002 │:3003 │:3004 │:3005 │:3006 │ ← 6个子服务 │
  │文件   │数据   │网页   │系统   │代码   │记忆   │           │
  │系统   │解析   │概览   │控制   │沙盒   │管理   │           │
  └──────┴──────┴──────┴──────┴──────┴──────┘           │
                         │
                         ▼
                本地文件系统 / 终端 / Python

  ## 功能模块

  | 模块 | 端口 | 能力 | 工具列表 |
  |------|------|------|----------|
  | **Filesystem** | 3001 | 文件系统管理 | `read_file` `write_file` `edit_file` `list_dir` `delete_file` `move_file`
  `copy_file` `search_files` `file_info` `extract_archive` `compress_files` |
  | **Data_Transform** | 3002 | 数据文档解析 | PDF/Excel/CSV/Word/XML 解析，JSON/MD 格式转换 |
  | **Web_Overview** | 3003 | 网页信息概览 | 网页加载、核心骨架提取 (Title/Meta/H1-H3/正文摘要) |
  | **System_Control** | 3004 | 终端与系统控制 | Shell/CMD 执行、进程管理、剪贴板读写、端口检测 |
  | **Code_Interpreter** | 3005 | Python 运行沙盒 | Python 脚本执行、REPL 交互、图表生成 |
  | **Memory_System** | 3006 | 记忆与状态管理 | 键值存储、语义搜索、上下文压缩 |

  ## 技术栈

  - **前端**: Vue 3 + Vite 8 + Tailwind CSS 4
  - **服务端**: TypeScript + Express 5 + @modelcontextprotocol/sdk
  - **传输协议**: SSE (Server-Sent Events) + Streamable HTTP 双模传输
  - **中间层**: n8n 工作流 + DeepSeek 模型
  - **数据解析**: pdf-parse, xlsx, mammoth (Word), cheerio (HTML), fast-xml-parser

  ## 快速开始

  ### 环境要求

  - Node.js >= 18
  - npm 或 pnpm
  - n8n（可选，用于 AI 编排）

  ### 1. 启动 MCP Server

  ```bash
  cd "mcp server"
  npm install
  npm run build
  npm start

  启动后会同时运行 6 个子服务 + 1 个路由器：

  ========== MCP Server 集群 ==========
  [Filesystem]       MCP Server → http://localhost:3001/sse | /mcp
  [Data_Transform]   MCP Server → http://localhost:3002/sse | /mcp
  [Web_Overview]     MCP Server → http://localhost:3003/sse | /mcp
  [System_Control]   MCP Server → http://localhost:3004/sse | /mcp
  [Code_Interpreter] MCP Server → http://localhost:3005/sse | /mcp
  [Memory_System]    MCP Server → http://localhost:3006/sse | /mcp
  [总开关]           路由器 → http://localhost:3000
  =====================================

  2. 启动前端

  cd frontend
  npm install
  npm run dev

  访问 http://localhost:5173 即可使用聊天界面。

  3. 配置 n8n（可选）

  导入项目根目录的 My workflow 17 (1).json 工作流文件，在 n8n 中配置 MCP Client 节点连接到各子服务的 SSE 地址。

  项目结构

  ├── frontend/                  # Vue 3 前端
  │   ├── src/
  │   │   ├── components/        # UI 组件
  │   │   │   ├── Sidebar.vue    # 左侧模式导航
  │   │   │   ├── ChatWindow.vue # 中间聊天窗口
  │   │   │   ├── ChatHistory.vue# 右侧历史记录
  │   │   │   ├── InputBar.vue   # 输入框
  │   │   │   └── MessageBubble.vue # 消息气泡
  │   │   ├── composables/
  │   │   │   ├── useChat.js     # 聊天逻辑
  │   │   │   └── useSession.js  # Session 管理
  │   │   ├── App.vue            # 主布局
  │   │   └── main.js            # 入口
  │   ├── vite.config.ts         # Vite 配置 (含代理)
  │   └── package.json
  ├── mcp server/                # MCP Server 集群
  │   ├── src/
  │   │   ├── index.ts           # 主入口 + 路由器 + 文件系统工具
  │   │   ├── transform.ts       # Data_Transform 模块
  │   │   ├── web.ts             # Web_Overview 模块
  │   │   ├── system.ts          # System_Control 模块
  │   │   ├── code.ts            # Code_Interpreter 模块
  │   │   └── memory.ts          # Memory_System 模块
  │   ├── tsconfig.json
  │   └── package.json
  ├── My workflow 17 (1).json    # n8n 工作流配置
  ├── claude.md                  # AI Agent 系统提示词
  └── README.md

  API 接口

  路由器 (localhost:3000)

  ┌──────┬────────┬─────────────────────────────────────────────────────────────────┐
  │ 方法 │  路径  │                              说明                               │
  ├──────┼────────┼─────────────────────────────────────────────────────────────────┤
  │ GET  │ /      │ 查看所有模式及端点                                              │
  ├──────┼────────┼─────────────────────────────────────────────────────────────────┤
  │ POST │ /tool  │ 通用工具调用 { tool, args, mcp_mode, sessionId }                │
  ├──────┼────────┼─────────────────────────────────────────────────────────────────┤
  │ POST │ /batch │ 跨模式批量调用 { calls: [{ mcp_mode, tool, args }], sessionId } │
  └──────┴────────┴─────────────────────────────────────────────────────────────────┘

  子服务 (localhost:3001-3006)

  ┌──────┬──────┬──────────────────────┐
  │ 方法 │ 路径 │         说明         │
  ├──────┼──────┼──────────────────────┤
  │ GET  │ /sse │ SSE 连接端点         │
  ├──────┼──────┼──────────────────────┤
  │ POST │ /mcp │ Streamable HTTP 端点 │
  └──────┴──────┴──────────────────────┘

  开发模式

  # MCP Server 热重载
  cd "mcp server"
  npm run dev

  # 前端热重载
  cd frontend
  npm run dev

  License

  ISC
