# Cloudflare Toolkit

[![CI](https://github.com/systemt1st/Cloudflare-Toolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/systemt1st/Cloudflare-Toolkit/actions/workflows/ci.yml)

一个面向 Cloudflare 批量运维场景的全栈工具箱。

它提供统一的 Web 控制台，用来批量管理 Cloudflare 账号、域名、
DNS、SSL、缓存、规则、速度优化及其它常见开关，并配套任务系统、
日志、订阅/积分和基础支付能力。

当前仓库已经包含可运行的前后端代码，不是只停留在原型图或方案文档。

## 适用场景

- 需要批量管理大量 Cloudflare 域名和 Zone
- 需要把高频重复操作做成任务化流程
- 需要保留操作日志、失败项、导出结果和任务追踪
- 希望基于现有代码继续扩展 SaaS、后台工具或内部平台

## 核心能力

- 用户系统
  - 邮箱注册、邮箱密码登录、Google 登录
  - Access Token + Refresh Token Cookie
  - 忘记密码、重置密码、修改昵称、修改密码
- Cloudflare 凭据管理
  - 操作账户 CRUD
  - 凭据加密存储
  - 凭据校验
  - 域名缓存与刷新
- 批量域名操作
  - 批量添加域名
  - 批量删除域名
  - 待激活域名筛选
  - 域名导出 CSV
- 批量 DNS 操作
  - 批量解析
  - 批量替换记录值
  - 批量删除记录
  - 批量切换代理状态
- 批量站点设置
  - SSL / TLS / HTTPS
  - 缓存设置与清除缓存
  - 速度优化与传输优化
  - 规则读取、克隆、删除
  - 其它常见开关项
- 任务系统
  - Redis 持久化任务状态
  - SSE 实时进度流
  - 任务取消
  - 失败项重试
  - 结果导出 CSV
  - 断线恢复与游标续传
- 商业化基础设施
  - 免费额度、积分扣减、限流
  - 订阅状态同步
  - Stripe 支付接入骨架
  - BEPUSDT 支付接入骨架
  - 操作日志记录与查询

详细清单见 [docs/TASKS.md](docs/TASKS.md)。

## 技术栈

- 前端：Next.js 14、React 18、TypeScript、Tailwind CSS、next-intl
- 后端：FastAPI、SQLAlchemy Async、Alembic、Redis、SSE
- 数据库：PostgreSQL
- 部署：Docker Compose、Nginx
- CI：GitHub Actions

## 项目结构

```text
.
├── frontend/                # Next.js 前端
├── backend/                 # FastAPI 后端
├── docker/                  # Nginx 与支付相关配置
├── docs/                    # 功能清单与补充文档
├── docker-compose.dev.yml   # 本地开发依赖
└── docker-compose.yml       # 全量部署编排
```

## 架构总览

```text
浏览器
  │
  ├── Next.js 前端
  │     ├── 登录 / 仪表盘 / 批量操作页
  │     └── SSE 订阅任务进度
  │
  └── FastAPI 后端
        ├── Auth / Users / Accounts
        ├── Domains / DNS / SSL / Cache / Rules / Other
        ├── Tasks / Subscriptions / Payments / Logs
        ├── Cloudflare API Client
        └── Redis 任务状态 / PostgreSQL 业务数据
```

## 当前状态

- 已有完整前后端主干代码
- GitHub Actions 已配置基础 CI
- 本地验证通过：
  - `backend/.venv/bin/python -m unittest discover -s backend/tests -p 'test_*.py'`
  - `cd frontend && npm run lint`
  - `cd frontend && npm run build`

当前更适合作为一个可继续迭代的工程底座，而不是“零配置即生产可用”的成品。

<img width="3006" height="1668" alt="image" src="https://github.com/user-attachments/assets/0d9738b5-d4c6-49d7-9082-519e6550d2ce" />
<img width="2978" height="1654" alt="image" src="https://github.com/user-attachments/assets/d4c54610-238a-4dc5-89aa-e91a77810abe" />




## 快速开始

### 1. 准备环境

- Python 3.11+
- Node.js 20+
- Docker / Docker Compose

### 2. 启动开发依赖

```bash
docker compose -f docker-compose.dev.yml up -d
```

默认会启动：

- PostgreSQL：`localhost:5432`
- Redis：`localhost:6379`
- BEPUSDT：`localhost:8080`，仅在 `payments` profile 下启用

如需启用 BEPUSDT：

```bash
docker compose -f docker-compose.dev.yml --profile payments up -d
```

### 3. 配置后端环境

后端默认从 `backend/.env` 读取配置。你可以手动创建该文件，或直接用环境变量启动。

最小开发配置示例：

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export ENV=dev
export DATABASE_URL=postgresql+asyncpg://dev:dev123@localhost:5432/cf_toolkit_dev
export REDIS_URL=redis://localhost:6379/0
export JWT_SECRET=dev_only_jwt_secret_please_change
export ENCRYPTION_KEY=$(python - <<'PY'
from cryptography.fernet import Fernet
print(Fernet.generate_key().decode())
PY
)

alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

后端启动后可访问：

- 健康检查：<http://localhost:8000/healthz>
- Swagger：<http://localhost:8000/docs>
- ReDoc：<http://localhost:8000/redoc>

### 4. 启动前端

```bash
cd frontend
npm install
npm run dev
```

前端默认地址：

- <http://localhost:3000>

如果遇到 `.next` 产物不一致导致的启动问题：

```bash
cd frontend
npm run dev:clean
```

## 生产部署

仓库提供了完整的 `docker-compose.yml`，包含：

- `frontend`
- `backend`
- `postgres`
- `redis`
- `nginx`

建议流程：

```bash
cp .env.example .env
docker compose up -d --build
```

生产环境至少需要认真配置这些变量：

- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `GOOGLE_CLIENT_ID`
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- `NEXT_PUBLIC_API_URL`
- `FRONTEND_BASE_URL`

可选能力按需配置：

- `RESEND_API_KEY`、`RESEND_FROM`
- `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`STRIPE_PRICE_ID_YEARLY`
- `COOKIE_SECURE`

完整配置模板见 [.env.example](.env.example)。

## 关键实现说明

### 任务系统

- 任务状态保存在 Redis
- 每个任务项按事件流输出进度
- 前端通过 SSE 实时订阅
- 支持取消、导出、失败项重试、断线恢复

核心代码：

- [backend/app/services/task_engine.py](backend/app/services/task_engine.py)
- [backend/app/api/v1/tasks.py](backend/app/api/v1/tasks.py)
- [frontend/src/lib/task-sse.ts](frontend/src/lib/task-sse.ts)

### Cloudflare API 调用

- 内置请求封装
- 统一错误处理
- 429 退避重试
- 进程内限流
- Redis 分布式限流兜底

核心代码：

- [backend/app/services/cloudflare/client.py](backend/app/services/cloudflare/client.py)
- [backend/app/core/rate_limiter.py](backend/app/core/rate_limiter.py)

### 安全相关

- Cloudflare 凭据使用 Fernet 加密存储
- 生产环境强制校验 `JWT_SECRET` 与 `ENCRYPTION_KEY`
- Cookie 鉴权配合 CSRF 校验
- 批量接口有用户级限流

## 已知限制

- 自动化测试覆盖还不深，当前以基础验证为主
- 第三方能力依赖真实配置，开箱即用程度取决于环境变量是否完整
- 支付相关目前更偏“能力骨架”，上线前仍需补充业务闭环验证
- 文档和功能会继续迭代，部分章节描述可能滞后于代码实现

## 开发建议

- 先从 `docs/TASKS.md` 了解功能面
- 先跑通开发环境，再逐个验证 Cloudflare 操作接口
- 如果你要做二次开发，建议优先补：
  - 集成测试
  - 权限模型
  - 支付回调与对账
  - 部署与监控文档

## 贡献

欢迎提交 Issue 和 PR。

在提交前，建议至少完成以下检查：

```bash
backend/.venv/bin/python -m unittest discover -s backend/tests -p 'test_*.py'
cd frontend && npm run lint
cd frontend && npm run build
```

## 许可证

当前仓库暂未附带 `LICENSE` 文件。

在补充正式许可证之前，代码默认不以开源许可证方式授权。
