# Quality Upgrade Plan

> 对比 dove 项目评估 lyre 的 L1/L2/L3/G1/G2/D1 层级覆盖率和 CI/CD 设置，
> 识别可优化点并制定升级计划。

## 现状对比

### 总览

| 层级 | Dove | Lyre | 状态 |
|------|------|------|------|
| **L1 单元测试** | vitest + 95% coverage | bun test + 90% handler | ⚠️ |
| **L2 API E2E** | e2e/api + route gate | route glue/smoke only | ⚠️ |
| **L3 BDD E2E** | e2e/bdd + page gate | 无 | ❌ |
| **G1 静态分析** | typecheck + lint | typecheck + lint | ✅ |
| **G2a Secrets** | gitleaks | gitleaks | ✅ |
| **G2b Deps** | osv-scanner | osv-scanner | ✅ |
| **CI** | L1+L2+L3+G1+G2 | L1+G1+G2 | ⚠️ |
| **CD** | release.yml | 无 | ❌ |

### Hooks 对比

**Dove pre-commit** (并行):
```
typecheck | lint:staged | gate:secrets | gate:routes | gate:pages | test:coverage
```

**Lyre pre-commit** (串行):
```
gitleaks → lint → test → typecheck → macOS
```

**Dove pre-push**:
```
test:e2e:api | gate:deps
```

**Lyre pre-push**:
```
osv-scanner → lint → typecheck → test:coverage → web:build → macOS
```

### 缺失组件清单

| # | 组件 | Dove 路径 | Lyre 状态 |
|---|------|-----------|-----------|
| 0 | vitest 迁移 | `vitest.config.ts` | ⚠️ 使用 bun test |
| 1 | 真实 Worker E2E 测试 | `e2e/api/` | ⚠️ 仅 route glue |
| 2 | BDD E2E 测试 | `e2e/bdd/` | ❌ 缺失 |
| 3 | E2E 运行脚本 | `scripts/run-e2e.ts` | ❌ 缺失 |
| 4 | Route 覆盖门禁 | `scripts/check-route-coverage.ts` | ❌ 缺失 |
| 5 | Page 覆盖门禁 | `scripts/check-page-coverage.ts` | ❌ 缺失 |
| 6 | 统一安全门禁 | `scripts/gate-secrets.ts` + `scripts/gate-deps.ts` | ❌ 分散 |
| 7 | Playwright 配置 | `playwright.config.ts` | ❌ 缺失 |
| 8 | CD Workflow | `.github/workflows/release.yml` | ❌ 缺失 |
| 9 | 并行 Hooks | `.husky/pre-commit` | ❌ 串行 |
| 10 | 细粒度覆盖率 | vitest thresholds | ❌ 仅 handler lines |

---

## 升级计划

### P0: 质量门禁补齐

#### 1. bun test → vitest 迁移 (L1 前置)

**动机**: bun test 支持 lcov reporter，但缺少成熟的 per-file JSON 解析和细粒度 threshold 配置。
vitest 的 v8 coverage provider 原生支持 JSON output + per-file thresholds，与 dove 保持一致。

**迁移范围**:
- `packages/api/src/__tests__/` — 117 tests (核心)
- `apps/api/src/__tests__/` — 25 tests
- `apps/web/src/__tests__/` — 13 tests

**新增文件**:
- `vitest.config.ts` — 全局配置 (参考 dove)
- `packages/api/vitest.config.ts` — workspace 配置

**新增依赖**:
- `vitest` — root devDependencies (或各 workspace)
- `@vitest/coverage-v8` — 覆盖率 provider
- `jsdom` 或 `happy-dom` — apps/web 测试需要 DOM 环境

**bun:sqlite 处理方案**:
packages/api 测试 fixture 依赖 `drizzle-orm/bun-sqlite` 和 `bun:sqlite`，
vitest 默认 Node runtime 下无法运行。两种方案：

| 方案 | 优点 | 缺点 |
|------|------|------|
| A: 改用 better-sqlite3 | vitest 原生支持，不依赖 Bun | 需改 test-db.ts，drizzle driver 不同 |
| B: 保留 packages/api handler tests 用 Bun | 零改动 | 覆盖率工具链不统一 |

**推荐方案 B**: packages/api 的 handler tests 继续用 `bun test` (Bun runtime + bun:sqlite)，
apps/web 和 apps/api (Worker glue) 迁移到 vitest。覆盖率先按 workspace 独立统计，
后续再考虑统一。

**修改**:
- `package.json` — `test` 脚本保持组合：`bun run web:test && bun run worker:test && bun run api:test`
  - `web:test` = `vitest run` (apps/web)
  - `worker:test` = `vitest run` (apps/api)
  - `api:test` = `bun test` (packages/api，保持 Bun runtime + bun:sqlite)
- `package.json` — `test:coverage` 脚本：`bun run web:test:coverage && bun run worker:test:coverage && bun run api:test:coverage`
  - `web:test:coverage` / `worker:test:coverage` = vitest JSON output
  - `api:test:coverage` = 现有 Bun text gate (packages/api/scripts/check-coverage.ts)
- `apps/web/package.json` — 添加 `vitest`, `@vitest/coverage-v8`, `happy-dom`
- `apps/api/package.json` — 添加 `vitest`, `@vitest/coverage-v8`
- `packages/api/package.json` — 保持不变
- `packages/api/scripts/check-coverage.ts` — 保持现有 Bun text 解析逻辑
- `apps/web/src/__tests__/*.test.ts` — 改 import，添加 happy-dom 环境
- `apps/api/src/__tests__/*.test.ts` — 改 import

**验收**:
- [ ] `bun run test` 全绿 (vitest + bun test 混合)
- [ ] `bun run web:test:coverage` 输出 JSON 格式
- [ ] `bun run worker:test:coverage` 输出 JSON 格式
- [ ] `bun run api:test:coverage` 保持现有 Bun text gate 通过
- [ ] 覆盖率阈值按 lines/functions/branches/statements 配置 (vitest workspace)

---

#### 2. 真实 Worker Runtime E2E (L2)

**现状**: 已有 `apps/api/src/__tests__/routes.test.ts` 做 Hono route glue/smoke 测试，
但没有通过 wrangler dev 跑真实 Worker/D1/中间件环境。

**目标**: 在真实 Worker runtime (wrangler dev --env test + local SQLite D1) 下运行关键 API 流程。

**测试覆盖标准** (按 METHOD + path，非仅根路径):
```
GET    /api/live
GET    /api/me
GET    /api/recordings          (list)
POST   /api/recordings          (create)
GET    /api/recordings/:id
DELETE /api/recordings/:id
POST   /api/upload/presign
GET    /api/dashboard
GET    /api/search?q=
PUT    /api/settings/backy      (update config)
POST   /api/settings/backy/test (test connection)
HEAD   /api/backy/pull          (webhook auth)
```

**新增文件**:
- `e2e/api/` — Worker runtime E2E 测试目录
- `scripts/run-e2e.ts` — 启动 `wrangler dev --env test` + 跑测试 + 清理
- `scripts/check-route-coverage.ts` — 解析 route 覆盖，需处理：
  - `.get()` / `.post()` / `.put()` / `.delete()` / `.head()` 等显式 method 调用
  - `.all()` 路由 (如 `apps/api/src/routes/backy.ts:28`)：需特殊处理，
    判断内部的 method dispatch 或标记为"全覆盖"
  - **推荐**：维护显式 `e2e/api/route-manifest.ts`，列出所有 METHOD + path，
    gate 检查 manifest vs e2e 测试文件的覆盖

**修改**:
- `package.json` 添加 `test:e2e` 脚本
- `.husky/pre-push` 添加 L2 gate

**验收**:
- [ ] `bun run test:e2e` 通过
- [ ] `bun run gate:routes` 通过 (METHOD + path 级别覆盖)
- [ ] CI L2 job 绿 (需确认 base-ci `enable-l2` input)

---

#### 3. 统一安全门禁脚本

**设计原则**: gitleaks 和 osv-scanner 运行语义不同，需分层调用：

```bash
bun run gate:secrets   # gitleaks protect --staged (pre-commit 语义)
bun run gate:deps      # osv-scanner scan --lockfile=bun.lock (pre-push 语义)
```

不要合并成默认"全部跑"，否则 pre-commit 可能变慢，pre-push 可能扫不到 staged secrets。

**新增文件**:
- `scripts/gate-secrets.ts` — gitleaks wrapper
- `scripts/gate-deps.ts` — osv-scanner wrapper

**验收**:
- [ ] `bun run gate:secrets` 在 pre-commit 中运行
- [ ] `bun run gate:deps` 在 pre-push 中运行

---

### P1: 重要改进

#### 4. 添加 L3 BDD E2E 测试

> **前置条件**: 确认 `nocoo/base-ci/.github/workflows/bun-quality.yml@v2026.1`
> 是否支持 `enable-l3` input。当前 CI 只有 `enable-l2`。如不支持，
> 需先升级 base-ci 或自行在 CI workflow 中添加 L3 job。

**登录态策略**:
- 使用 `E2E_SKIP_AUTH=true` (env.test) 绕过 Cloudflare Access
- Playwright 通过 `storageState` 复用登录态，避免每个 spec 重复登录
- `/api/me` 返回合成测试用户，无需真实 SSO

**API Fixture 策略**:
- 每个 BDD spec 运行前 seed 测试数据 (recordings, folders, tags)
- spec 运行后 cleanup，保证隔离
- 使用 `wrangler d1 execute --local --file e2e/fixtures/schema.sql` 初始化
- 新增 `e2e/fixtures/schema.sql` — 从 Drizzle schema 生成 (或手动维护)
- 新增 `e2e/fixtures/seed.sql` — 测试数据 (用户、录音、文件夹、标签)
- **schema 来源**: 运行 `drizzle-kit generate` 生成 SQL，或从 `packages/api/src/db/schema.ts` 手动导出

**页面覆盖标准** (按 route path):
```
/                    (dashboard)
/recordings          (list)
/recordings/:id      (detail)
/settings            (general)
/settings/ai         (AI provider)
/settings/storage    (OSS)
/settings/tokens     (device tokens)
```

**未登录跳转测试**:
- 本地 (`E2E_SKIP_AUTH=true`)：测 `/api/me` 401 后前端 `window.location.reload()` 行为
  (逻辑在 `apps/web/src/lib/api.ts:42`)
- 生产/staging smoke：测 Cloudflare Access 重定向 (需真实 Access 配置，不在 E2E 范围内)

**新增文件**:
- `e2e/bdd/` — Playwright BDD 测试目录
- `playwright.config.ts`
- `scripts/check-page-coverage.ts`

**新增依赖**:
- `@playwright/test`

**验收**:
- [ ] `bun run test:e2e:bdd` 通过
- [ ] `bun run gate:pages` 通过 (页面路径级别覆盖)
- [ ] CI L3 job 绿 (需确认 base-ci `enable-l3` input)

---

#### 5. 并行化 pre-commit hooks

**前置条件**: 先记录当前 pre-commit 基线耗时：

```bash
time git commit --allow-empty -m "benchmark"
```

**注意**: 当前 pre-commit 包含 `xcodebuild test` 和 `swiftlint` (见 `.husky/pre-commit:15`)，
并行后可能吃 CPU、拉长总耗时。建议：
- pre-commit: gitleaks + lint + typecheck + test (并行)
- pre-push: osv-scanner + coverage + web:build + macOS (保持串行，macOS 任务不适合 pre-commit)

**验收**:
- [ ] 记录基线耗时
- [ ] 并行化后对比提升

---

### P2: 锦上添花

#### 6. 细粒度覆盖率阈值

**现状**: `packages/api/scripts/check-coverage.ts` 解析 bun test 文本表格，计算 handler 文件平均行覆盖率。
单纯平均值会掩盖某个关键 handler 覆盖率很低的问题。
例如 jobs.ts 覆盖率 80% 会被 recordings.ts 的 93% 拉到平均值以上。

**短期改进** (保持 Bun，改进现有 gate):
- 从"平均值"改成 per-file 最低值：任意 handler 文件低于阈值则失败
- 解析更多指标：functions / branches / statements

```typescript
// per-file 最低阈值 (handler 层)
const HANDLER_THRESHOLD = { lines: 90, functions: 90, branches: 80, statements: 90 };
```

**长期方案** (如需统一 JSON 覆盖率):
- 将 packages/api handler tests 迁移到 vitest (需解决 bun:sqlite → better-sqlite3/D1 mock)
- 或使用 Bun 原生 JSON/LCOV reporter (如后续 Bun 版本支持)

---

#### 7. 测试质量审计脚本

**新增文件**:
- `scripts/audit-test-quality.ts`

**检查项**:
- 测试文件命名规范 (`*.test.ts`)
- 每个测试至少一个 assertion
- 无 `.skip` / `.only` 遗留
- handler 测试覆盖所有 HTTP methods

---

### 独立模块: Release Automation

> CD 不是质量门禁，而是发布策略，单独拆出。

#### 8. CD Workflow

**目标**: tag push 自动部署到 Cloudflare Workers

**新增文件**:
- `.github/workflows/release.yml`

**策略**:
```
v*.*.* tag push → version check (tag == package.json) → build → wrangler deploy
main CI green   → auto-deploy latest (需 environment protection)
workflow_dispatch → 手动选择 tag 部署
```

**安全要求**:
- environment: `production` (需 GitHub environment protection rules)
- concurrency: `deploy-worker-production` (cancel-in-progress: false)
- secrets: `CLOUDFLARE_API_TOKEN` (需配置)
- dry-run: 不支持 (wrangler deploy 无 --dry-run，但可先 deploy:test 验证)
- rollback: `wrangler rollback --version-id <id>` 或手动 `git revert` + `wrangler deploy`

---

## 实施顺序

```
Phase 0 (前置): #1 vitest 迁移 (覆盖率基础)
Phase 1 (P0):   #2 真实 Worker E2E → #3 统一安全门禁
Phase 2 (P1):   #4 L3 BDD (确认 base-ci 支持) → #5 并行 hooks (先量测基线)
Phase 3 (P2):   #6 细粒度覆盖率 → #7 审计脚本
独立模块:       #8 Release Automation (需 environment protection + secrets)
```

## 参考

- dove 项目: `../dove/`
- base-ci: `nocoo/base-ci/.github/workflows/bun-quality.yml@v2026.1`
- 当前 CI: `.github/workflows/ci.yml`
- 当前 hooks: `.husky/pre-commit`, `.husky/pre-push`
