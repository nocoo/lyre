# D1 兼容性 Spike

`docs/03-cf-worker-migration-plan.md` Wave B.0 的前置 gate。验证 lyre schema +
高风险查询路径在 D1 dialect 下的行为。

## 目录结构

```
d1-spike/
├── README.md            ← 本文件
├── schema.ts            ← 复用 apps/web_legacy/src/db/schema.ts（验证一致）
├── 0000_init.sql        ← drizzle-kit generate 出的初始化 SQL（手写等价）
├── spike.test.ts        ← Bun test, 用 drizzle-orm/d1 + miniflare 内存 D1
└── wrangler.spike.toml  ← 独立 wrangler config（不进 monorepo 主流程）
```

## 验证项与产出

| # | 验证项 | 现实现位置 | 验收 |
|---|---|---|---|
| 1 | `.returning()` 在 INSERT/UPDATE | repos/{users,recordings,jobs,...}.ts | drizzle-orm/d1 原生支持，行为同 better-sqlite3 |
| 2 | 多语句事务（`db.transaction`） | repos/recordings.ts、repos/tags.ts、services/backup.ts | **D1 不支持 interactive txn** → 改用 `db.batch([...])` |
| 3 | 复合 join + where + order + limit | repos/recordings.ts、search route | drizzle 标准 builder，dialect 透明 |
| 4 | 时间戳 (`integer({mode:"timestamp"})`) | schema 全表 | D1 = SQLite，行为一致 |
| 5 | drizzle-kit generate 出的 SQL apply | 0000_init.sql | wrangler d1 execute --file 通过 |

## 跑法

```bash
cd packages/api/scripts/d1-spike
bun install                                    # 独立 deps（wrangler、drizzle-orm/d1、@cloudflare/workers-types）
bun test spike.test.ts                         # Miniflare 内存 D1 + drizzle-orm/d1
```

## findings

见主迁移文档 `docs/03-cf-worker-migration-plan.md` 中 Wave B.0 spike-findings 表。
