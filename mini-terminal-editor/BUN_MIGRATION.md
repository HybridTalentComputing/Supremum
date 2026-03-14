# Bun 迁移指南

## ✅ 已完成的步骤

1. **更新 package.json 脚本**
   - `tsx scripts/generate-file-icons.ts` → `bun scripts/generate-file-icons.ts`
   - `npm run generate:icons` → `bun run generate:icons`

2. **添加 packageManager 字段**
   - 告诉项目使用 Bun 作为包管理器

## 🔄 待完成步骤

### 1. 安装 Bun

选择以下任一方式：

**方式 A：使用官方安装脚本**
```bash
curl -fsSL https://bun.sh/install | bash
```

**方式 B：使用 Homebrew**
```bash
brew install oven-sh/bun/bun
```

**方式 C：使用 npm**
```bash
npm install -g bun
```

### 2. 重新安装依赖

```bash
# 删除旧的 lockfile（可选）
rm package-lock.json

# 使用 Bun 安装依赖
bun install
```

### 3. 验证迁移

```bash
# 测试图标生成脚本
bun run generate:icons

# 启动开发服务器
bun run dev
# 或
npm run tauri dev
```

## 📋 迁移对比

| 操作 | npm | Bun |
|------|-----|-----|
| 安装依赖 | `npm install` | `bun install` |
| 运行脚本 | `npm run dev` | `bun run dev` |
| TypeScript | 需要 `tsx` | 内置支持 |
| 安装速度 | 基准 | ~6x 更快 |

## ⚠️ 注意事项

- `npm run` 仍然可用（会自动调用 Bun）
- 如果遇到问题，可以随时回滚到 npm
- 无需修改代码，完全兼容

## 🔄 回滚方法

如果需要回滚到 npm：

1. 删除 `packageManager` 字段
2. 恢复 `tsx` 依赖
3. 修改脚本回使用 `tsx`
4. 运行 `npm install`

```bash
npm install tsx
# 编辑 package.json 恢复原来的脚本
```
