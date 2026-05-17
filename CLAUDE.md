# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Qwerty Learner 是一个为键盘工作者设计的单词记忆与英语肌肉记忆锻炼软件，将单词背诵与键盘输入练习相结合。基于 React + Vite + TypeScript 构建，使用 Jotai 进行状态管理，Tailwind CSS 编写样式，IndexedDB (Dexie.js) 存储本地练习记录。

## 常用命令

```bash
yarn start          # 启动开发服务器 (http://localhost:5173)
yarn build          # 生产构建 (输出到 build/)
yarn lint           # ESLint 检查
yarn prettier       # 代码格式化
yarn test:e2e       # Playwright E2E 测试 (针对线上环境 https://qwerty.kaiyi.cool)
```

## 核心架构

### 路由与页面

路由定义在 `src/index.tsx`，基于 react-router-dom v6:

- `/` — TypingPage（主打字练习页面）
- `/gallery` — GalleryPage（词库选择，懒加载）
- `/analysis` — AnalysisPage（数据分析，懒加载）
- `/error-book` — ErrorBook（错题本）
- `/friend-links` — FriendLinks（友情链接）
- `/mobile` — MobilePage（移动端页面）

### 状态管理 (Jotai)

**全局状态** — `src/store/index.ts` 定义所有全局 atom，包括当前词典、章节、发音设置、键盘音效、默写模式、暗黑模式、AI 提供商配置等。大部分配置使用 `atomWithStorage` 持久化到 localStorage。

**`atomForConfig`** — `src/store/atomForConfig.ts` 是一个自定义 atom 工厂函数，基于 `atomWithStorage` 扩展，在读取时自动检测类型不匹配/缺失属性并以默认值补齐。所有可持久化的配置都应使用此函数。

**练习状态** — `src/pages/Typing/store/` 使用 React Context + useImmerReducer 管理打字练习的局部状态（章节数据、计时器、输入记录等），不进入全局 store。

### 打字练习核心流程

1. `useWordList` hook (`src/pages/Typing/hooks/useWordList.ts`) 通过 useSWR 从 `/dicts/` 获取 JSON 词库文件，根据当前章节切片
2. `TypingPage` (`src/pages/Typing/index.tsx`) 用 useImmerReducer 管理 `TypingState`，协调整个练习生命周期
3. `WordPanel` (`src/pages/Typing/components/WordPanel/index.tsx`) 是核心组件，处理用户输入、正确/错误判定、单词循环、章节完成等逻辑
4. 完成章节后弹出 `ResultScreen`（结果页面），展示正确率/WPM/错词回顾，支持 AI 讲解和习题测试

### 词库系统

- 词库定义在 `src/resources/dictionary.ts`，导出 `dictionaries` 数组和 `idDictionaryMap` 映射
- 每个词库是一个 `DictionaryResource`，包含 id、name、url（指向 `/dicts/` 下的 JSON 文件）、语言类型等
- `languageCategory` 区分语种类别（en/ja/de/code/kk/id），`language` 是具体语言
- ESLint 规则要求 `sort-imports`，import 语句需按字母排序

### 数据持久化

`src/utils/db/index.ts` — 基于 Dexie.js 的 IndexedDB 封装 (`RecordDB`):

- `wordRecords` — 每个单词的详细练习记录（时间、错误次数、按键间隔）
- `chapterRecords` — 每章节的汇总记录
- `reviewRecords` — 错题复习记录

### 组件体系

- `src/components/ui/` — 基于 Radix UI 的基础组件（dialog、tabs、tooltip 等），使用 CVA 管理变体样式
- `src/components/` — 业务组件（Header、Footer、Layout 等）
- 图标使用 `unplugin-icons` 自动导入，前缀 `~icons/`

### Tauri 桌面应用

`src-tauri/` 包含 Rust 编写的 Tauri 桌面端壳，但当前开发主要面向 Web 端。

### 路径别名

`@/` 映射到 `src/`（在 vite.config.ts 和 tsconfig.json 中配置）。

### CSS Modules

CSS Modules 使用 `camelCaseOnly` 模式（vite.config.ts 配置），导入时使用驼峰命名。
