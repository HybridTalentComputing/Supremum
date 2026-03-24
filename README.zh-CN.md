<div align="center">

<img width="full" alt="Supremum" src="docs/images/workspace-overview-ai-editor-terminal.png" />

### 面向 AI 时代的简单、轻量但强大的 AI 代码编辑器。

<sub><strong>Supremum v0.0.1 已发布。</strong> 可在 <a href="https://github.com/HybridTalentComputing/Supremum/releases">Releases</a> 下载。</sub>

> <sub><strong>macOS 提醒：</strong> 如果 macOS 提示 `Supremum.app` 已损坏，或阻止它打开，请直接查看下方的 <a href="#macos-安装提醒">macOS 安装提醒</a> 获取说明。</sub>

</div>


## 为什么选择 Supremum？

Supremum 是一个围绕真实 coding CLI、真实终端、本地文件和集成代码审查打造的本地桌面工作区。

它保留 CLI 原本的工作流，再在外层补上缺失的 UI。

| 问题 | Supremum 的做法 |
| --- | --- |
| Raw coding CLI 很强，但太手工 | 增加 launcher tabs、历史恢复、上下文传递和集成 review |
| VS Code / Cursor 对 terminal-first 工作流来说偏重 | 用更轻的 workspace 包住真实终端会话 |
| 文件、终端输出和 diff 是割裂的 | 把 Files、Editor、Changes、Diff 和 AI 会话放在同一个地方 |
| 上下文传递太重复 | 可以直接把文件、文件夹、代码选区、终端输出发给 Claude Code |
| 多会话很容易乱 | AI Coding CLI 和 Terminal 都支持横向分栏 |

## 安装包体积对比

基于当前本地构建/下载的 macOS 安装包：

| 应用 | 安装包 | 体积 |
| --- | --- | --- |
| **Supremum** | **macOS ARM64 DMG** | **`4.71 MB`** |
| Cursor | macOS ARM64 DMG | `248.91 MB` |
| VS Code | macOS Universal DMG | `252.38 MB` |

**Supremum 当前安装包不到 5 MB。**  
按这组对比数据看，当前 Supremum 安装包体积大约只有 Cursor 和 VS Code 的 **`1/53`**。

这里对比的是安装包文件大小，不代表运行时内存占用或解压后的完整应用体积。

## 与 Coding CLI 的工作流集成

| 优化点 | 解决什么问题 |
| --- | --- |
| Preset launcher tabs | 从 UI 直接启动支持的 coding CLI，而不是先掉进空白 shell |
| Recent session resume | 不用记住 resume 命令，也能恢复 Claude Code 会话 |
| Explorer 到 Claude Code context | 从文件树直接把文件或文件夹加入 Claude Code |
| Explorer 多选批量添加 | 一次发送多个上下文项 |
| Editor 选区到 Claude Code context | 从编辑器直接发送局部代码 |
| Terminal 输出到 Claude Code | 把错误、日志、命令输出直接发给 Claude Code |
| 新会话和旧会话共用入口 | 启动与恢复都在同一个 launcher 流程里 |
| AI / Terminal 分栏 | 并行工作时保持多个会话可见且清晰 |

目前 Claude Code 的集成深度最高。

<div align="center">
  <img alt="从工作区把选中的文件和代码加入 CLI 上下文" src="docs/images/add-to-cli-context.png" width="1200" />
</div>

## 核心工作区

| 工作区 | 作用 |
| --- | --- |
| AI Coding CLI | 启动支持的 coding CLI、恢复最近的 Claude Code 会话、横向分栏多个 AI pane |
| Terminal | 运行原生终端、横向分栏、把选中的终端输出发送给 Claude Code |
| Editor | 以 tab 打开文件、横向分栏编辑、在支持的场景下使用 code / preview 模式、发送选中的代码给 Claude Code |
| Files | 用集成文件树浏览本地项目 |
| Changes | 在工作区中查看仓库变更 |
| Diff | 打开专门的 diff 工作区做代码审查 |

## 一个典型工作流

| 步骤 | 动作 |
| --- | --- |
| 1 | 打开本地项目 |
| 2 | 启动新的 coding CLI 会话，或者恢复之前的 Claude Code 会话 |
| 3 | 在 Explorer 浏览文件，并在 Editor 中打开需要的内容 |
| 4 | 把文件、文件夹、代码选区或终端输出发送给 Claude Code |
| 5 | 在 Editor、Changes 和 Diff 中审查结果 |

## 当前支持的 Coding CLI

| CLI | 当前支持情况 |
| --- | --- |
| Claude Code | 支持 preset 启动、历史恢复、上下文传递，集成最完整 |
| Codex | 支持 preset 启动 |
| Gemini | 支持 preset 启动 |
| OpenCode | 支持 preset 启动 |
| Copilot | 支持 preset 启动 |
| Cursor Agent | 支持 preset 启动 |
| Customization | 后续支持 |

## 快速开始

### 前置依赖

- [Bun](https://bun.sh/)
- Rust toolchain
- 当前平台所需的 Tauri 依赖
- 已安装并可通过 `PATH` 调用的 coding CLI

### 安装

```bash
bun install
```

### 开发模式运行

```bash
bun run tauri dev
```

### 构建前端产物

```bash
bun run build
```

### 打包 macOS 安装包

```bash
bun run build:dmg:all
```

可用命令：

- `bun run build:dmg:arm64` 用于 Apple Silicon
- `bun run build:dmg:x64` 用于 Intel
- `bun run build:dmg:universal` 用于通用 macOS 版本
- `bun run build:dmg:all` 一次构建三个版本

构建后的 DMG 会统一收集到：

`src-tauri/target/release-artifacts/<version>/macos`

### macOS 安装提醒

**警告**

当前 GitHub Release 提供的 macOS 安装包还没有完成 notarization。
如果 macOS 提示安装包或应用“已损坏”或阻止打开，请按下面步骤处理。

1. 打开 DMG，把 `Supremum.app` 拖到 `Applications`
2. 如果第一次启动时拦的是安装后的应用，先给应用本体移除 quarantine：

```bash
xattr -dr com.apple.quarantine "/Applications/Supremum.app"
```

3. 如果第 2 步还不行，或者 DMG 还没打开就被系统拦截，再给 DMG 移除 quarantine 后重试：

```bash
xattr -dr com.apple.quarantine ~/Downloads/Supremum_0.0.1_aarch64.dmg
```

**大多数情况下，只需要执行第 2 步。**
第 3 步是补充兜底，用在 app 命令仍然无效，或者 DMG 本身先被系统拦截的情况。

## 设计哲学

| 原则 | 含义 |
| --- | --- |
| 默认简单 | UI 不应该干扰工作流 |
| 整体轻量 | 工作区应该聚焦，而不是臃肿 |
| 通过组合获得强大 | 终端、文件、编辑器和 diff 要自然协同 |
| Terminal-native | 保留真实 CLI，而不是用假的聊天抽象替代它 |
| 显式上下文 | 用户应该知道自己发送了什么给模型 |
| Local-first | 围绕真实本地项目和本地开发流程设计 |

## 当前限制

- 历史会话恢复目前主要围绕 Claude Code
- 部分能力是 CLI 特定的，而不是所有 CLI 完全一致
- 外部 CLI 需要用户自行安装，并确保可以通过 `PATH` 调用

## 技术栈

| 层级 | 技术 |
| --- | --- |
| Desktop shell | Tauri 2 |
| Frontend | React 19 + Vite |
| Terminal | xterm.js |
| Editor | CodeMirror 6 |
| UI | shadcn/ui、Radix UI、Base UI |
| Backend | Rust，用于 PTY 和文件操作 |

## 许可证

Supremum 使用 GNU General Public License v3.0 许可证。

完整文本请见 [LICENSE](./LICENSE)。
