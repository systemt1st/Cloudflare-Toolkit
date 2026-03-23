# CF批量工具箱（开发中）

本仓库根据 `CF批量工具箱_方案设计文档.md` 初始化：`Next.js` 前端 + `FastAPI` 后端 + `PostgreSQL/Redis`。

## 目录结构

- `frontend/`：Next.js（App Router + Tailwind + next-intl）
- `backend/`：FastAPI（SQLAlchemy + Alembic + Redis + SSE）
- `docker/`：Nginx 配置
- `docker-compose.dev.yml`：开发环境（仅 Postgres/Redis）
- `docker-compose.yml`：全量（前后端 + Postgres/Redis + Nginx）

## 开发启动（推荐）

1) 启动依赖：

```bash
docker compose -f docker-compose.dev.yml up -d
```

2) 启动后端（新终端）：

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export ENV="dev"
export DATABASE_URL="postgresql+asyncpg://dev:dev123@localhost:5432/cf_toolkit_dev"
export REDIS_URL="redis://localhost:6379/0"
export JWT_SECRET="change_me"
export ENCRYPTION_KEY="change_me"  # 需替换为有效 Fernet Key
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

3) 启动前端（新终端）：

```bash
cd frontend
npm run dev
```

- 如果遇到类似 `Cannot find module './xxx.js'`（通常是 `.next` 产物不一致），先清理再启动：
  - `cd frontend && rm -rf .next-dev && npm run dev`
  - 或 `cd frontend && npm run dev:clean`

- 前端：http://localhost:3000
- 后端健康检查：http://localhost:8000/healthz

## 重要说明

- `ENCRYPTION_KEY` 必须是 Fernet Key（`Fernet.generate_key()` 输出），否则涉及“操作账户凭据加密/解密”的接口会报错。
- Google 登录需要同时配置 `GOOGLE_CLIENT_ID`（后端校验）与 `NEXT_PUBLIC_GOOGLE_CLIENT_ID`（前端渲染按钮）。
- 已实现主要批量能力（域名/DNS/SSL/缓存/规则/其它设置等）与任务/日志/订阅骨架，详见 `docs/TASKS.md`。
