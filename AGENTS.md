# AGENTS.md

本文件为 AI 编程助手提供项目上下文与协作规范，请在修改代码前先阅读。

## 项目简介

VS Code 扩展 "摸鱼看盘"（watch-stock）—— 在状态栏实时显示 A 股（沪/深/北）行情，支持价格闹钟、封单监控、大单异动检测。
技术栈：TypeScript + VS Code Extension API + esbuild，数据来源：新浪财经、腾讯财经公开行情接口。

## 常用命令

```bash
npm run typecheck   # TypeScript 类型检查（tsc --noEmit）
npm run build       # 类型检查 + esbuild 打包 + vsce 打包成 .vsix
```

调试：在 VS Code 中打开项目，按 F5 启动扩展开发宿主。

## 目录结构

```text
src/
├── extension.ts          # 插件入口（activate/deactivate）
├── commands.ts           # 命令注册与主菜单
├── config.ts             # 配置统一访问入口、常量定义
├── refresher.ts          # 行情刷新与定时器调度
├── types.ts              # 全局类型定义
├── global.d.ts           # 全局类型声明
├── managers/             # 业务管理器
│   ├── stockManager.ts   # 股票增删排序
│   ├── alarmManager.ts   # 价格闹钟
│   ├── lockManager.ts    # 涨跌停封单监控
│   └── largeManager.ts   # 大单监控
├── services/             # 数据服务
│   ├── stockService.ts   # 行情查询（新浪/腾讯双源）
│   └── stockSearch.ts    # 股票搜索
├── ui/                   # UI 模块
│   ├── statusBar.ts      # 状态栏渲染
│   └── stockHome.ts      # 详情面板（Webview）
├── utils/                # 通用工具
│   ├── http.ts           # HTTP 请求
│   ├── msg.ts            # 消息提示
│   ├── stock.ts          # 股票代码/价格处理
│   └── time.ts           # 交易时间判断
└── webview/              # Webview HTML 模板
    ├── stockHome.html
    ├── stockOverview.html
    ├── stockDetail.html
    └── stockChart.html
```

## 核心架构

### 数据流（主循环）

```
refresher.ts（交易时间每 5 秒一次）
  → stockService.ts（从新浪/腾讯拉取行情）
  → 每只股票计算封单 calculateLockInfo()（lockManager.ts）
  → 检查价格闹钟 checkAlarms()（alarmManager.ts）
  → 检查封单异动 / 大单异动（仅开启且稳定交易时段）
  → statusBar.ts 渲染（或隐藏）
```

### 关键设计决策

- **入口**：`extension.ts` 创建 `AppState`，包含状态栏、用户显隐状态、定时器。
- **双数据源**：新浪用于批量行情（有买一/卖一，用于封单计算），腾讯用于完整行情（PE、PB、市值）和分时数据。早盘集合竞价期间（9:15-9:25）新浪无价格 → `getStockList(codes, isSina=false)` 回退到腾讯简版行情。
- **统一配置入口**：所有 VS Code 配置读取必须通过 `config.ts` 的 `config` 对象，禁止在业务代码中直接调用 `vscode.workspace.getConfiguration`。`config.getStocks()` 会自动校验股票代码格式并回写合法值。
- **状态栏显隐三态**：`AppState.userForced` 为三态 —— `null` = 跟随市场（根据 `autoHideByMarket` 配置自动显隐），`true` = 强制显示，`false` = 强制隐藏。手动切换后脱离自动模式，需重启编辑器恢复。
- **Webview 面板**：`StockHomePanel` 是单例，构建时将 4 个 HTML 模板通过 esbuild `text` loader 内联为字符串。占位符（`{{NONCE}}`、`{{OVERVIEW_HTML}}` 等）在运行时做字符串替换。每次加载面板生成新的 CSP nonce。修改 HTML 后无需手动构建，`npm run build` 自动压缩。
- **命令注册**：命令统一在 `commands.ts` 注册，命令 ID 集中在 `COMMAND_MAP`，禁止在其他文件中注册命令。
- **详情面板**：通过 Webview 加载 `src/webview/*.html`，由 esbuild 内联为字符串。
- **消息限流**：`msg.ts` 的 `sendRateLimitMsg()` 将封单/大单异动通知在 60 秒冷却窗口内合并，避免频繁弹窗打扰用户。
- **分时数据缓存**：`StockHomePanel` 中分时数据有 10 秒 TTL 缓存，避免切换股票标签时重复请求。

## 编码规范

### 八荣八耻

- 以清晰可读为荣，以晦涩难懂为耻
- 以简洁优雅为荣，以繁复冗余为耻
- 以直观一致为荣，以迷惑随机为耻
- 以明确可靠为荣，以猜测含糊为耻
- 以稳健容错为荣，以崩溃无示为耻
- 以遵循规范为荣，以破坏架构为耻
- 以复用现有为荣，以创造接口为耻
- 以人类确认为荣，以臆想执行为耻

### 命名

- 变量与函数：小驼峰 `camelCase`
- 类型/接口：大驼峰 `PascalCase`
- 文件名：小驼峰 `camelCase.ts`
- 常量：全大写 `SNAKE_CASE`

### TypeScript

- 禁用 `any`，使用具体类型或 `unknown`
- 函数参数与返回值必须显式标注类型
- 对象类型用 `interface`，联合/工具类型用 `type`
- 启用 `strict`、`noUnusedLocals`、`noUnusedParameters`，提交前清理未使用代码

### 代码组织

- `import` 顺序：第三方库 → 项目内部模块 → 类型定义（`import type`）
- 同一路径只 `import` 一次，所有 `import` 置于文件顶部
- 单文件不超过 300 行，单函数不超过 30 行，嵌套不超过 3 层
- 异步错误用 `try-catch` 处理，给出有意义的错误信息

### Webview / HTML

- HTML 模板以 `text` 形式被 esbuild 内联，无需考虑路径
- 占位符使用 `{{ key }}` 形式，由 TS 侧字符串替换

## 关键约定

- 股票代码格式：交易所前缀 + 6 位数字，如 `sh600519`、`sz000001`、`bj899050`
- 大盘指数代码列表在 `config.ts` 的 `INDEX_CODES`
- 行业板块代码列表在 `config.ts` 的 `INDUSTRY_CODES`
- 基金/ETF 判断：`utils/stock.ts` 的 `isFund()` —— SH 5xxxxx、SZ 1xxxxx，或名称包含 ETF/LOF/基金/指数
- 交易时间判断统一走 `utils/time.ts`，禁止在业务代码中硬编码时间
- 状态栏显示数量由 `maxDisplayCount` 控制（默认 5）
- 仅支持 A 股（沪/深/北），不支持港股、美股、期货、场外基金
- 消息提示统一调用 `utils/msg.ts` 的 `sendMsg`，不要直接用 `vscode.window.showXxxMessage`

## 开发流程

### 修改代码前

- 先阅读相关文件了解上下文
- 检查是否有可复用的实现
- 涉及 `package.json` 依赖增删/版本变更必须先与用户确认

### 修改代码后

- 检查能否在功能不变的前提下简化逻辑
- 运行 `npm run typecheck` 确保类型通过
- 清理未使用的导入、变量、注释

## 不要做

- 不要修改 `dist/`、`node_modules/`、`versions/`、`*.vsix` 等构建产物
- 不要在业务代码中直接调用 `vscode.workspace.getConfiguration`，请走 `config.ts`
- 不要在 `commands.ts` 之外注册命令
- 不要在状态栏渲染中做异步请求，请先在 `refresher.ts` 拉好数据

## 反馈与发布

- 用户反馈渠道：[GitHub Issues](https://github.com/pbstar/watch-stock/issues)
- 版本号在 `package.json` 与 `CHANGELOG.md` 同步维护
