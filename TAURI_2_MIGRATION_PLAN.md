# Tauri 2.0 复刻 Superset - 技术方案

## 📋 目录

- [项目概述](#项目概述)
- [技术栈选择](#技术栈选择)
- [架构设计](#架构设计)
- [开发路线图](#开发路线图)
- [关键决策说明](#关键决策说明)

---

## 🎯 项目概述

### 目标

基于 **Tauri 2.0** 复刻 Superset 的核心功能，打造一个轻量级、高性能的桌面开发者工具。

### 核心特性

- ✅ **多工作区管理** - Git 仓库管理、文件树浏览
- ✅ **代码编辑器** - CodeMirror 6，多语言支持
- ✅ **Git 集成** - Diff 查看、提交、分支管理
- ✅ **终端集成** - xterm.js，多会话管理
- ✅ **AI 辅助** - OpenAI 集成，智能代码生成
- ✅ **任务管理** - Linear/ GitHub Issues 集成

### 优势对比

| 特性 | Superset (Electron) | Tauri 2.0 方案 |
|------|---------------------|----------------|
| **包体积** | ~150MB | ~3MB |
| **内存占用** | ~200MB | ~50MB |
| **启动速度** | ~2s | ~0.5s |
| **性能** | 好 | 优秀 |
| **技术栈** | JS/TS | Rust + JS/TS |

---

## 🛠️ 技术栈选择

### 前端核心技术

```json
{
  "框架": "React 19",
  "路由": "@tanstack/react-router",
  "状态管理": "Zustand + TanStack Query",
  "UI 组件": "shadcn/ui + Radix UI + TailwindCSS v4",
  "表单": "react-hook-form + zod",
  "拖拽": "@dnd-kit",
  "虚拟化": "@tanstack/react-virtual"
}
```

### 编辑器技术

```json
{
  "代码编辑器": "CodeMirror 6",
  "语法高亮": "Lezer + Shiki",
  "Diff 查看": "@pierre/diffs",
  "Markdown": "Tiptap",
  "终端": "xterm.js"
}
```

### 后端技术 (Rust)

```toml
[dependencies]
tauri = "2.0"
tokio = "1"
git2 = "0.18"
portable-pty = "0.8"
notify = "6.0"
sqlx = "0.7"  # 可选
reqwest = "0.11"
```

### 完整依赖清单

见附录：[完整依赖列表](#完整依赖列表)

---

## 🏗️ 架构设计

### 项目结构

```
your-app/
├── src-tauri/                      # Rust 后端
│   ├── src/
│   │   ├── commands/              # Tauri Commands
│   │   │   ├── workspace.rs       # 工作区管理
│   │   │   ├── git.rs             # Git 操作
│   │   │   ├── terminal.rs        # 终端控制
│   │   │   ├── editor.rs          # 编辑器操作
│   │   │   └── fs.rs              # 文件系统
│   │   ├── services/              # 后台服务
│   │   │   ├── terminal_host.rs   # PTY 进程管理
│   │   │   ├── git_daemon.rs      # Git 守护进程
│   │   │   └── file_watcher.rs    # 文件监控
│   │   └── utils/                 # 工具函数
│   └── Cargo.toml
│
├── src/                           # React 前端
│   ├── components/                # 基础组件
│   │   ├── ui/                    # shadcn/ui 组件
│   │   ├── editors/               # 编辑器组件
│   │   │   ├── CodeMirror/
│   │   │   ├── DiffViewer/
│   │   │   └── MarkdownEditor/
│   │   ├── terminal/
│   │   └── layout/
│   │
│   ├── features/                  # 功能模块
│   │   ├── workspace/             # 工作区管理
│   │   ├── git/                   # Git 功能
│   │   ├── editor/                # 编辑器功能
│   │   ├── terminal/              # 终端功能
│   │   └── ai/                    # AI 功能
│   │
│   ├── routes/                    # 路由页面
│   ├── stores/                    # 全局状态
│   ├── lib/                       # 工具函数
│   └── hooks/                    # 自定义 Hooks
│
└── 配置文件...
```

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      Tauri 2.0 桌面应用                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                  React 前端层                         │  │
│  │  工作区管理 | 代码编辑器 | Git 集成 | 终端 | AI 聊天  │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │               Tauri IPC 层                            │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                  Rust 后端层                          │  │
│  │  Git 操作 | PTY 进程 | 文件系统 | HTTP 客户端        │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                   操作系统                            │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 核心组件说明

#### 1. CodeMirror 6 编辑器

**职责**:
- 文本编辑和显示
- 语法高亮
- 搜索替换
- 多光标编辑

**关键接口**:
```typescript
interface CodeEditorAdapter {
  focus(): void;
  getValue(): string;
  setValue(value: string): void;
  revealPosition(line: number, column?: number): void;
  getSelectionLines(): EditorSelectionLines | null;
  selectAll(): void;
  cut(): void;
  copy(): void;
  paste(): void;
  openFind(): void;
  dispose(): void;
}
```

**支持的语言**: JavaScript, TypeScript, Python, Rust, Go, Java, C++, HTML, CSS, JSON, Markdown, SQL, YAML, PHP, XML 等

#### 2. @pierre/diffs Diff 查看器

**职责**:
- 显示 Git 变更
- Split/Unified 两种视图
- Shiki 语法高亮
- 虚拟滚动（处理大文件）

**特点**:
- 来自 diffs.com 的专业级 Diff 工具
- VS Code 同款的 Shiki 引擎
- 可处理 10 万行以上的大型 diff

#### 3. xterm.js 终端

**职责**:
- 终端模拟
- PTY 连接
- 多会话管理

**插件**:
- `@xterm/addon-fit` - 自适应大小
- `@xterm/addon-search` - 搜索功能
- `@xterm/addon-web-links` - 链接点击
- `@xterm/addon-serialize` - 会话序列化

---

## 📅 开发路线图

### Phase 1: 项目初始化 (Week 1-2)

**目标**: 搭建基础项目结构和开发环境

**任务清单**:
- [ ] 创建 Tauri 2.0 项目
- [ ] 配置 React + TypeScript
- [ ] 配置 TailwindCSS v4
- [ ] 初始化 shadcn/ui
- [ ] 配置路由 (TanStack Router)
- [ ] 配置状态管理 (Zustand + TanStack Query)
- [ ] 创建基础布局（侧边栏 + 顶部栏 + 主内容区）
- [ ] 实现主题切换（明/暗模式）

**交付物**:
- ✅ 可运行的 Tauri 应用
- ✅ 基础 UI 框架
- ✅ 开发环境配置完成

---

### Phase 2: 工作区管理 (Week 3-4)

**目标**: 实现工作区的 CRUD 功能

**后端任务**:
- [ ] 实现工作区模型 (`Workspace` struct)
- [ ] 实现工作区 Commands
  - `create_workspace`
  - `list_workspaces`
  - `delete_workspace`
  - `update_workspace`
- [ ] 实现 Git 集成
  - 检测 Git 仓库
  - 获取当前分支
  - 获取仓库状态

**前端任务**:
- [ ] 创建工作区 Store (Zustand)
- [ ] 实现工作区侧边栏组件
  - `WorkspaceSidebar.tsx`
  - `WorkspaceList.tsx`
  - `WorkspaceListItem.tsx`
- [ ] 实现项目选择对话框
  - 本地文件夹选择
  - Git 仓库克隆
- [ ] 实现拖拽重排序

**交付物**:
- ✅ 可管理工作区
- ✅ 显示 Git 状态
- ✅ 拖拽排序

---

### Phase 3: 代码编辑器 (Week 5)

**目标**: 集成 CodeMirror 6 编辑器

**任务清单**:
- [ ] 安装 CodeMirror 6 依赖
- [ ] 实现 `CodeEditorAdapter` 接口
- [ ] 实现 `CodeMirrorEditor` 组件
  - 基础配置
  - 主题定制
  - 语言支持
  - 快捷键
  - 搜索替换
- [ ] 实现文件操作
  - 打开文件
  - 保存文件
  - 关闭文件
- [ ] 实现多标签页
  - `TabStrip.tsx`
  - 标签切换
  - 标签关闭
- [ ] 实现编辑器上下文菜单

**交付物**:
- ✅ 功能完整的代码编辑器
- ✅ 支持 10+ 种语言
- ✅ 多标签页管理

---

### Phase 4: Git 功能 (Week 6)

**目标**: 实现 Git 变更查看和提交功能

**后端任务**:
- [ ] 实现 Git Commands
  - `git_status`
  - `git_diff`
  - `git_commit`
  - `git_branch`
  - `git_checkout`

**前端任务**:
- [ ] 安装 Diff 查看器 (`@pierre/diffs`)
- [ ] 实现 `DiffViewer` 组件
- [ ] 实现变更侧边栏
  - `ChangesSidebar.tsx`
  - `FileList.tsx`
  - `FileDiffSection.tsx`
- [ ] 实现提交对话框
  - `CommitDialog.tsx`
  - 提交消息编辑
  - 暂存/取消暂存
- [ ] 实现分支选择器
  - `BranchSelector.tsx`
  - 创建新分支
  - 切换分支

**交付物**:
- ✅ 完整的 Git 工作流
- ✅ Diff 查看器
- ✅ 提交和分支管理

---

### Phase 5: 终端集成 (Week 7)

**目标**: 集成 xterm.js 终端

**后端任务**:
- [ ] 实现 PTY 支持 (`portable-pty`)
- [ ] 实现终端 Commands
  - `create_terminal`
  - `write_to_terminal`
  - `resize_terminal`
  - `destroy_terminal`
- [ ] 实现终端事件
  - `terminal:data`
  - `terminal:exit`

**前端任务**:
- [ ] 安装 xterm.js 及插件
- [ ] 实现 `Terminal` 组件
  - PTY 连接
  - 数据收发
  - 大小调整
- [ ] 实现多会话管理
  - 会话列表
  - 会话切换
  - 会话终止
- [ ] 实现终端配置
  - Shell 选择
  - 字体设置
  - 颜色主题

**交付物**:
- ✅ 功能完整的终端
- ✅ 多会话支持
- ✅ 可定制配置

---

### Phase 6: AI 集成 (Week 8 - 可选)

**目标**: 集成 OpenAI API

**任务清单**:
- [ ] 实现 OpenAI Command
- [ ] 实现聊天界面
  - `ChatPanel.tsx`
  - `ChatInput.tsx`
  - `MessageList.tsx`
- [ ] 实现工具调用
  - 文件读取
  - 命令执行
  - Git 操作
- [ ] 实现流式响应

**交付物**:
- ✅ AI 聊天功能
- ✅ 工具调用能力
- ✅ 流式响应

---

## 🔑 关键决策说明

### 1. CodeMirror 6 vs Monaco Editor

**决策**: ✅ 使用 CodeMirror 6

**理由**:
- **更小的包体积**: ~150KB vs Monaco 的 2MB
- **更好的性能**: 状态机架构，更快的渲染
- **模块化设计**: 按需加载语言支持
- **完全的可定制性**: 可以精确控制每个功能
- **Superset 已验证**: 直接参考实现

**对比**:

| 特性 | CodeMirror 6 | Monaco Editor |
|------|--------------|---------------|
| 大小 | ~150KB | ~2MB |
| 性能 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 可定制性 | 极高 | 中等 |
| 学习曲线 | 陡峭 | 中等 |
| 适合场景 | 桌面应用 | Web IDE |

---

### 2. @pierre/diffs vs react-diff-viewer-continued

**决策**: ✅ 使用 @pierre/diffs

**理由**:
- **专业级 Diff 工具**: 来自 diffs.com
- **Shiki 语法高亮**: VS Code 同款引擎
- **虚拟滚动**: 处理大型 diff（10万+ 行）
- **多文件支持**: 内置 `MultiFileDiff` 组件
- **Superset 已验证**: 直接参考实现

**对比**:

| 特性 | @pierre/diffs | react-diff-viewer-continued |
|------|---------------|---------------------------|
| 语法高亮 | Shiki (⭐⭐⭐⭐⭐) | Prism.js (⭐⭐⭐) |
| 性能 | 虚拟滚动 (⭐⭐⭐⭐⭐) | 全量渲染 (⭐⭐⭐) |
| 大小 | ~200KB | ~50KB |
| 功能 | 非常丰富 | 基础功能 |

---

### 3. Tauri vs Electron

**决策**: ✅ 使用 Tauri 2.0

**理由**:
- **包体积**: ~3MB vs Electron 的 ~150MB
- **内存占用**: ~50MB vs Electron 的 ~200MB
- **性能**: Rust 后端更高效
- **安全性**: Rust 内存安全
- **启动速度**: ~0.5s vs Electron 的 ~2s

**对比**:

| 特性 | Tauri 2.0 | Electron |
|------|-----------|----------|
| 包体积 | ~3MB | ~150MB |
| 内存占用 | ~50MB | ~200MB |
| 启动速度 | ~0.5s | ~2s |
| 后端语言 | Rust | Node.js |
| API 集成 | 原生 | 需要 FFI |

---

### 4. Zustand vs Redux

**决策**: ✅ 使用 Zustand

**理由**:
- **更简单的 API**: 更少的样板代码
- **更好的 TypeScript 支持**: 类型推断更准确
- **内置持久化**: `persist` 中间件
- **更小的包体积**: ~1KB vs Redux 的 ~15KB

---

### 5. TanStack Router vs React Router

**决策**: ✅ 使用 TanStack Router

**理由**:
- **类型安全的路由**: 完全的类型推断
- **更好的性能**: 自动代码分割
- **内置数据加载**: 类似 Next.js 的 `getServerSideProps`
- **现代化的设计**: 专为 React 19 设计

---

## 📚 参考资料

### 官方文档

- [Tauri 2.0 文档](https://v2.tauri.app/)
- [CodeMirror 6 文档](https://codemirror.net/docs/)
- [xterm.js 文档](https://xtermjs.org/)
- [@pierre/diffs 文档](https://github.com/pierre/diffs)
- [shadcn/ui 文档](https://ui.shadcn.com/)

### Superset 源码参考

- [Superset GitHub](https://github.com/superset-sh/superset)
- [CodeMirror 实现](apps/desktop/src/renderer/screens/main/components/WorkspaceView/components/CodeEditor/)
- [Terminal 实现](apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/Terminal/)
- [Git 实现](apps/desktop/src/renderer/screens/main/components/WorkspaceView/ChangesContent/)

### 相关文章

- [CodeMirror 6 迁移指南](https://codemirror.net/docs/migration/)
- [Tauri vs Electron 对比](https://v2.tauri.app/start/faq/)
- [Shiki 语法高亮](https://shiki.style/)

---

## 附录：完整依赖列表

### 前端依赖 (package.json)

```json
{
  "dependencies": {
    "react": "^19",
    "react-dom": "^19",
    "@tauri-apps/api": "^2.0",
    "@tauri-apps/plugin-shell": "^2.0",
    "@tanstack/react-router": "^1.147",
    "@tanstack/react-query": "^5.90",
    "zustand": "^5.0",
    "@radix-ui/react-dialog": "^1.1",
    "@radix-ui/react-dropdown-menu": "^2.1",
    "@radix-ui/react-select": "^2.1",
    "@radix-ui/react-tabs": "^1.1",
    "@radix-ui/react-tooltip": "^1.1",
    "@radix-ui/react-context-menu": "^2.2",
    "@radix-ui/react-scroll-area": "^1.1",
    "tailwindcss": "^4.1",
    "tailwind-merge": "^3.4",
    "clsx": "^2.1",
    "@codemirror/state": "^6.5",
    "@codemirror/view": "^6.39",
    "@codemirror/basic-setup": "^0.21",
    "@codemirror/commands": "^6.10",
    "@codemirror/search": "^6.6",
    "@codemirror/lang-javascript": "^6.2",
    "@codemirror/lang-python": "^6.2",
    "@codemirror/lang-rust": "^6.0",
    "@codemirror/lang-go": "^6.0",
    "@codemirror/lang-html": "^6.4",
    "@codemirror/lang-css": "^6.3",
    "@codemirror/lang-json": "^6.0",
    "@codemirror/lang-markdown": "^6.5",
    "@codemirror/lang-yaml": "^6.1",
    "@codemirror/theme-one-dark": "^6.1",
    "@xterm/xterm": "^6.1",
    "@xterm/addon-fit": "^0.12",
    "@xterm/addon-search": "^0.17",
    "@xterm/addon-web-links": "^0.13",
    "@pierre/diffs": "^1.0",
    "@tiptap/react": "^3.17",
    "@tiptap/starter-kit": "^3.17",
    "react-resizable-panels": "^3.0",
    "@dnd-kit/core": "^6.3",
    "fuse.js": "^7.1",
    "zod": "^4.3",
    "react-hook-form": "^7.71"
  }
}
```

### 后端依赖 (Cargo.toml)

```toml
[dependencies]
tauri = { version = "2.0", features = ["shell-open"] }
tauri-plugin-shell = "2.0"
tauri-plugin-dialog = "2.0"
tauri-plugin-fs = "2.0"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
git2 = "0.18"
portable-pty = "0.8"
notify = "6.0"
walkdir = "2.0"
reqwest = { version = "0.11", features = ["json"] }
tracing = "0.1"
anyhow = "1.0"
thiserror = "1.0"
```

---

## 🎯 总结

这个方案提供了一个**清晰、可执行**的技术路线，用于基于 Tauri 2.0 复刻 Superset 的核心功能。

### 核心优势

1. **技术栈成熟** - 所有技术都经过 Superset 验证
2. **架构清晰** - 模块化设计，易于维护
3. **性能优秀** - Tauri + CodeMirror + xterm.js
4. **开发效率** - shadcn/ui + TanStack Router + Zustand

### 预期成果

- ✅ **包体积**: ~3MB（vs Superset 的 ~150MB）
- ✅ **启动时间**: <1s
- ✅ **内存占用**: <100MB
- ✅ **功能完整**: 工作区、编辑器、Git、终端、AI

### 下一步

1. **开始 Phase 1** - 创建项目
2. **参考 Superset** - 复用组件设计
3. **迭代开发** - 按 8 周计划推进
4. **持续优化** - 性能和用户体验

祝开发顺利！🚀
