# CF批量工具箱 方案设计文档

## 一、系统架构

### 1.1 整体架构图

```mermaid
graph TB
    subgraph frontend [Frontend - Next.js]
        Web[Web Application]
        SSR[Server Side Rendering]
        I18n[next-intl]
    end

    subgraph backend [Backend - FastAPI]
        API[REST API]
        SSE_Server[SSE Server]
        TaskEngine[Batch Task Engine]
        CFClient[Cloudflare Client]
    end

    subgraph storage [Storage Layer]
        PG[(PostgreSQL)]
        Redis[(Redis)]
    end

    subgraph external [External Services]
        CF[Cloudflare API]
        Google[Google OAuth]
        Resend[Resend Email]
    end

    Web --> API
    Web --> SSE_Server
    API --> PG
    API --> Redis
    TaskEngine --> Redis
    TaskEngine --> CFClient
    CFClient --> CF
    API --> Google
    API --> Resend
```

### 1.2 核心数据流

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Next.js
    participant BE as FastAPI
    participant R as Redis
    participant CF as Cloudflare API

    U->>FE: 提交批量任务
    FE->>BE: POST /api/tasks/batch
    BE->>R: 创建任务队列
    BE-->>FE: 返回 task_id
    FE->>BE: GET /api/tasks/{task_id}/stream (SSE)
    
    loop 批量执行
        BE->>CF: 执行单条操作
        CF-->>BE: 返回结果
        BE->>R: 更新进度
        BE-->>FE: SSE 推送进度
    end
    
    BE-->>FE: SSE 推送完成
    U->>FE: 查看结果/导出CSV
```

---

## 二、技术栈详情

### 2.1 前端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 14.x | 全栈框架，App Router |
| React | 18.x | UI 库 |
| TypeScript | 5.x | 类型安全 |
| next-intl | latest | 国际化 (中/英) |
| Tailwind CSS | 3.x | 样式框架 |
| shadcn/ui | latest | UI 组件库 |
| Zustand | latest | 状态管理 |
| React Hook Form | latest | 表单处理 |
| Zod | latest | 表单验证 |
| TanStack Query | latest | 数据请求缓存 |

### 2.2 后端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Python | 3.11+ | 运行环境 |
| FastAPI | 0.100+ | Web 框架 |
| SQLAlchemy | 2.x | ORM |
| Alembic | latest | 数据库迁移 |
| Pydantic | 2.x | 数据验证 |
| httpx | latest | 异步 HTTP 客户端 |
| redis-py | latest | Redis 客户端 |
| passlib + bcrypt | latest | 密码加密 |
| python-jose | latest | JWT 处理 |
| cryptography | latest | API 凭据加密 |
| sse-starlette | latest | SSE 支持 |

---

## 三、目录结构

### 3.1 项目根目录

```
cf-batch-toolkit/
├── frontend/                 # Next.js 前端
├── backend/                  # FastAPI 后端
├── docker/                   # Docker 配置
├── docs/                     # 文档
├── docker-compose.yml        # Docker Compose 配置
├── docker-compose.dev.yml    # 开发环境配置
├── .env.example              # 环境变量模板
└── README.md
```

### 3.2 前端目录结构

```
frontend/
├── src/
│   ├── app/                  # Next.js App Router
│   │   ├── [locale]/         # 国际化路由
│   │   │   ├── (auth)/       # 认证相关页面组
│   │   │   │   ├── login/
│   │   │   │   ├── register/
│   │   │   │   └── forgot-password/
│   │   │   ├── (dashboard)/  # 控制台页面组
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── dashboard/
│   │   │   │   ├── accounts/         # 操作账户管理
│   │   │   │   ├── domains/          # 域名管理
│   │   │   │   │   ├── add/
│   │   │   │   │   ├── delete/
│   │   │   │   │   └── export/
│   │   │   │   ├── dns/              # DNS 管理
│   │   │   │   │   ├── resolve/
│   │   │   │   │   ├── replace/
│   │   │   │   │   ├── delete/
│   │   │   │   │   └── proxy/
│   │   │   │   ├── ssl/              # SSL/TLS 设置
│   │   │   │   ├── cache/            # 缓存设置
│   │   │   │   ├── speed/            # 传输优化
│   │   │   │   ├── rules/            # 规则管理
│   │   │   │   │   ├── clone/
│   │   │   │   │   └── delete/
│   │   │   │   ├── other/            # 其他设置
│   │   │   │   └── settings/         # 用户设置
│   │   │   ├── page.tsx              # 首页
│   │   │   └── layout.tsx
│   │   ├── api/              # API Routes (可选)
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/               # shadcn/ui 组件
│   │   ├── layout/           # 布局组件
│   │   ├── domain/           # 域名选择器等业务组件
│   │   ├── task/             # 任务执行、进度、结果组件
│   │   └── forms/            # 表单组件
│   ├── hooks/                # 自定义 Hooks
│   ├── lib/                  # 工具函数
│   │   ├── api.ts            # API 客户端
│   │   ├── sse.ts            # SSE 客户端
│   │   └── utils.ts
│   ├── stores/               # Zustand stores
│   ├── types/                # TypeScript 类型定义
│   └── messages/             # 国际化文案
│       ├── zh.json
│       └── en.json
├── public/
├── next.config.js
├── tailwind.config.js
└── package.json
```

### 3.3 后端目录结构

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py               # FastAPI 入口
│   ├── config.py             # 配置管理
│   ├── database.py           # 数据库连接
│   ├── api/
│   │   ├── __init__.py
│   │   ├── deps.py           # 依赖注入
│   │   └── v1/
│   │       ├── __init__.py
│   │       ├── router.py     # 路由汇总
│   │       ├── auth.py       # 认证接口
│   │       ├── users.py      # 用户接口
│   │       ├── accounts.py   # 操作账户接口
│   │       ├── domains.py    # 域名管理接口
│   │       ├── dns.py        # DNS 管理接口
│   │       ├── ssl.py        # SSL 设置接口
│   │       ├── cache.py      # 缓存设置接口
│   │       ├── speed.py      # 传输优化接口
│   │       ├── rules.py      # 规则管理接口
│   │       ├── other.py      # 其他设置接口
│   │       └── tasks.py      # 任务管理接口
│   ├── models/               # SQLAlchemy 模型
│   │   ├── __init__.py
│   │   ├── user.py
│   │   ├── account.py
│   │   ├── domain_cache.py
│   │   ├── operation_log.py
│   │   └── subscription.py
│   ├── schemas/              # Pydantic 模型
│   │   ├── __init__.py
│   │   ├── user.py
│   │   ├── account.py
│   │   ├── domain.py
│   │   ├── dns.py
│   │   ├── task.py
│   │   └── common.py
│   ├── services/             # 业务逻辑层
│   │   ├── __init__.py
│   │   ├── auth.py
│   │   ├── user.py
│   │   ├── account.py
│   │   ├── cloudflare/       # Cloudflare 服务
│   │   │   ├── __init__.py
│   │   │   ├── client.py     # API 客户端
│   │   │   ├── zones.py      # Zone 操作
│   │   │   ├── dns.py        # DNS 操作
│   │   │   ├── settings.py   # 设置操作
│   │   │   └── rules.py      # 规则操作
│   │   ├── task_engine.py    # 批量任务引擎
│   │   └── email.py          # 邮件服务
│   ├── core/
│   │   ├── __init__.py
│   │   ├── security.py       # 安全相关
│   │   ├── encryption.py     # 加密工具
│   │   └── rate_limiter.py   # 限流器
│   └── utils/
│       ├── __init__.py
│       └── csv_export.py     # CSV 导出
├── alembic/                  # 数据库迁移
├── tests/                    # 测试
├── requirements.txt
└── Dockerfile
```

---

## 四、数据库设计

### 4.1 ER 图

```mermaid
erDiagram
    users ||--o{ cf_accounts : has
    users ||--o{ operation_logs : has
    users ||--o{ subscriptions : has
    cf_accounts ||--o{ domain_caches : has

    users {
        uuid id PK
        string email UK
        string password_hash
        string nickname
        string subscription_status
        int credits
        datetime created_at
        datetime updated_at
    }

    cf_accounts {
        uuid id PK
        uuid user_id FK
        string name
        string credential_type
        text encrypted_credentials
        datetime created_at
        datetime updated_at
    }

    domain_caches {
        uuid id PK
        uuid account_id FK
        string domain
        string zone_id
        string status
        datetime cached_at
    }

    operation_logs {
        uuid id PK
        uuid user_id FK
        string operation_type
        string target_domain
        string result
        text details
        datetime created_at
    }

    subscriptions {
        uuid id PK
        uuid user_id FK
        string plan_type
        datetime start_time
        datetime end_time
        string status
    }
```

### 4.2 表结构详情

#### users 表

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    nickname VARCHAR(50) NOT NULL,
    google_id VARCHAR(255),
    subscription_status VARCHAR(20) DEFAULT 'free',
    credits INTEGER DEFAULT 1000,
    credits_reset_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_google_id ON users(google_id);
```

#### cf_accounts 表

```sql
CREATE TABLE cf_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    credential_type VARCHAR(20) NOT NULL, -- 'api_token' | 'global_key'
    encrypted_credentials TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX idx_cf_accounts_user_id ON cf_accounts(user_id);
```

#### domain_caches 表

```sql
CREATE TABLE domain_caches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES cf_accounts(id) ON DELETE CASCADE,
    domain VARCHAR(255) NOT NULL,
    zone_id VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    name_servers TEXT[],
    cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(account_id, domain)
);

-- 索引
CREATE INDEX idx_domain_caches_account_id ON domain_caches(account_id);
CREATE INDEX idx_domain_caches_status ON domain_caches(status);
```

#### operation_logs 表

```sql
CREATE TABLE operation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    operation_type VARCHAR(50) NOT NULL,
    target_domain VARCHAR(255),
    result VARCHAR(20) NOT NULL, -- 'success' | 'failed'
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX idx_operation_logs_user_id ON operation_logs(user_id);
CREATE INDEX idx_operation_logs_created_at ON operation_logs(created_at DESC);
```

#### subscriptions 表

```sql
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_type VARCHAR(20) NOT NULL, -- 'free' | 'yearly'
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    status VARCHAR(20) NOT NULL, -- 'active' | 'expired' | 'cancelled'
    payment_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
```

### 4.3 Redis 数据结构

| Key 模式 | 类型 | 用途 | TTL |
|----------|------|------|-----|
| `task:{task_id}` | Hash | 任务状态和进度 | 24h |
| `task:{task_id}:results` | List | 任务执行结果 | 24h |
| `user:{user_id}:rate_limit` | String | 用户请求限流 | 1min |
| `account:{account_id}:domains` | String (JSON) | 域名列表缓存 | 30min |
| `session:{session_id}` | Hash | 用户会话信息 | 7d |

#### Redis 数据示例

**任务状态 (Hash)**
```
task:550e8400-e29b-41d4-a716-446655440000
  status: "running"
  total: 10
  current: 3
  success: 2
  failed: 1
  created_at: "2024-01-01T00:00:00Z"
```

**任务结果 (List)**
```
task:550e8400-e29b-41d4-a716-446655440000:results
[
  {"domain": "a.com", "status": "success", "message": "DNS record created"},
  {"domain": "b.com", "status": "error", "message": "Zone not found"},
  ...
]
```

---

## 五、API 设计

### 5.1 API 概览

#### 认证模块

| 端点 | 方法 | 描述 | 认证 |
|------|------|------|------|
| `/api/v1/auth/register` | POST | 用户注册 | 否 |
| `/api/v1/auth/login` | POST | 用户登录 | 否 |
| `/api/v1/auth/logout` | POST | 用户登出 | 是 |
| `/api/v1/auth/refresh` | POST | 刷新 Token | 否 |
| `/api/v1/auth/google` | POST | Google OAuth | 否 |
| `/api/v1/auth/forgot-password` | POST | 忘记密码 | 否 |
| `/api/v1/auth/reset-password` | POST | 重置密码 | 否 |

#### 用户模块

| 端点 | 方法 | 描述 | 认证 |
|------|------|------|------|
| `/api/v1/users/me` | GET | 获取当前用户 | 是 |
| `/api/v1/users/me` | PATCH | 更新用户信息 | 是 |
| `/api/v1/users/me/password` | PUT | 修改密码 | 是 |

#### 操作账户模块

| 端点 | 方法 | 描述 | 认证 |
|------|------|------|------|
| `/api/v1/accounts` | GET | 获取账户列表 | 是 |
| `/api/v1/accounts` | POST | 添加操作账户 | 是 |
| `/api/v1/accounts/{id}` | GET | 获取账户详情 | 是 |
| `/api/v1/accounts/{id}` | PATCH | 更新账户 | 是 |
| `/api/v1/accounts/{id}` | DELETE | 删除账户 | 是 |
| `/api/v1/accounts/{id}/verify` | POST | 验证凭据有效性 | 是 |
| `/api/v1/accounts/{id}/domains` | GET | 获取域名列表 | 是 |
| `/api/v1/accounts/{id}/domains/refresh` | POST | 刷新域名缓存 | 是 |

#### 域名管理模块

| 端点 | 方法 | 描述 | 认证 |
|------|------|------|------|
| `/api/v1/domains/add` | POST | 批量添加域名 | 是 |
| `/api/v1/domains/delete` | POST | 批量删除域名 | 是 |
| `/api/v1/domains/export` | POST | 导出域名列表 | 是 |
| `/api/v1/domains/pending` | GET | 获取待激活域名 | 是 |

#### DNS 管理模块

| 端点 | 方法 | 描述 | 认证 |
|------|------|------|------|
| `/api/v1/dns/resolve` | POST | 批量解析 DNS | 是 |
| `/api/v1/dns/replace` | POST | 批量替换 DNS 值 | 是 |
| `/api/v1/dns/delete` | POST | 批量删除 DNS | 是 |
| `/api/v1/dns/proxy` | POST | 批量设置代理状态 | 是 |

#### SSL/TLS 设置模块

| 端点 | 方法 | 描述 | 认证 |
|------|------|------|------|
| `/api/v1/ssl/batch` | POST | 批量 SSL 配置 | 是 |

#### 缓存设置模块

| 端点 | 方法 | 描述 | 认证 |
|------|------|------|------|
| `/api/v1/cache/batch` | POST | 批量缓存配置 | 是 |
| `/api/v1/cache/purge` | POST | 批量清除缓存 | 是 |

#### 传输优化模块

| 端点 | 方法 | 描述 | 认证 |
|------|------|------|------|
| `/api/v1/speed/batch` | POST | 批量传输优化配置 | 是 |

#### 规则管理模块

| 端点 | 方法 | 描述 | 认证 |
|------|------|------|------|
| `/api/v1/rules/read` | POST | 读取源域名规则 | 是 |
| `/api/v1/rules/clone` | POST | 批量克隆规则 | 是 |
| `/api/v1/rules/delete` | POST | 批量删除规则 | 是 |

#### 其他设置模块

| 端点 | 方法 | 描述 | 认证 |
|------|------|------|------|
| `/api/v1/other/batch` | POST | 批量杂项配置 | 是 |

#### 任务管理模块

| 端点 | 方法 | 描述 | 认证 |
|------|------|------|------|
| `/api/v1/tasks/{id}` | GET | 获取任务状态 | 是 |
| `/api/v1/tasks/{id}/stream` | GET | SSE 进度流 | 是 |
| `/api/v1/tasks/{id}/cancel` | POST | 取消任务 | 是 |
| `/api/v1/tasks/{id}/export` | GET | 导出结果 CSV | 是 |

### 5.2 核心请求/响应示例

#### 用户注册

```typescript
// POST /api/v1/auth/register
// Request
{
  "email": "user@example.com",
  "password": "securePassword123",
  "nickname": "username"
}

// Response 201
{
  "id": "uuid",
  "email": "user@example.com",
  "nickname": "username",
  "subscription_status": "free",
  "credits": 1000,
  "created_at": "2024-01-01T00:00:00Z"
}
```

#### 用户登录

```typescript
// POST /api/v1/auth/login
// Request
{
  "email": "user@example.com",
  "password": "securePassword123",
  "remember_me": true
}

// Response 200
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "expires_in": 900,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "nickname": "username",
    "subscription_status": "free",
    "credits": 1000
  }
}
// Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=Strict
```

#### 添加操作账户

```typescript
// POST /api/v1/accounts
// Request
{
  "name": "我的 Cloudflare 账号",
  "credential_type": "api_token",
  "credentials": {
    "api_token": "xxx..."
  }
}

// 或 Global API Key 方式
{
  "name": "我的 Cloudflare 账号",
  "credential_type": "global_key",
  "credentials": {
    "email": "cf@example.com",
    "api_key": "xxx..."
  }
}

// Response 201
{
  "id": "uuid",
  "name": "我的 Cloudflare 账号",
  "credential_type": "api_token",
  "created_at": "2024-01-01T00:00:00Z",
  "verified": true
}
```

#### 批量 DNS 解析

```typescript
// POST /api/v1/dns/resolve
// Request - 同值模式
{
  "account_id": "uuid",
  "mode": "same_value",
  "record_type": "A",
  "record_name": "@",
  "ttl": 1,
  "proxied": true,
  "domains": ["a.com", "b.com", "c.com"],
  "record_value": "1.2.3.4"
}

// Request - 不同值模式
{
  "account_id": "uuid",
  "mode": "different_value",
  "record_type": "A",
  "record_name": "@",
  "ttl": 1,
  "proxied": true,
  "records": [
    {"domain": "a.com", "value": "1.1.1.1"},
    {"domain": "b.com", "value": "2.2.2.2"}
  ]
}

// Request - 站群模式
{
  "account_id": "uuid",
  "mode": "site_group",
  "record_type": "A",
  "record_name": "@",
  "ttl": 1,
  "proxied": true,
  "domains": ["a.com", "b.com", "c.com", "d.com"],
  "values": ["1.1.1.1", "2.2.2.2"]
}

// Request - 自定义模式
{
  "account_id": "uuid",
  "mode": "custom",
  "records": [
    {"domain": "a.com", "name": "@", "type": "A", "value": "1.1.1.1", "ttl": 1, "proxied": true},
    {"domain": "b.com", "name": "www", "type": "CNAME", "value": "cdn.example.com", "ttl": 300, "proxied": false}
  ]
}

// Response 202
{
  "task_id": "uuid",
  "total": 10,
  "message": "Task created successfully"
}
```

#### 批量 SSL 配置

```typescript
// POST /api/v1/ssl/batch
// Request
{
  "account_id": "uuid",
  "domains": ["a.com", "b.com"],
  "settings": {
    "ssl_mode": "full",           // off | flexible | full | strict
    "always_use_https": true,
    "min_tls_version": "1.2",     // 1.0 | 1.1 | 1.2 | 1.3
    "tls_1_3": true,
    "automatic_https_rewrites": true,
    "opportunistic_encryption": true
  }
}

// Response 202
{
  "task_id": "uuid",
  "total": 2,
  "message": "Task created successfully"
}
```

#### 规则克隆

```typescript
// POST /api/v1/rules/read
// Request - 读取源域名规则
{
  "account_id": "uuid",
  "source_domain": "template.com",
  "rule_types": ["page_rules", "redirect_rules", "cache_rules"]
}

// Response 200
{
  "domain": "template.com",
  "rules": {
    "page_rules": [
      {"id": "xxx", "targets": [...], "actions": [...], "priority": 1}
    ],
    "redirect_rules": [...],
    "cache_rules": [...]
  }
}

// POST /api/v1/rules/clone
// Request - 克隆规则到目标域名
{
  "account_id": "uuid",
  "source_domain": "template.com",
  "target_domains": ["a.com", "b.com"],
  "rule_types": ["page_rules", "redirect_rules"],
  "selected_rules": {
    "page_rules": ["rule_id_1", "rule_id_2"],
    "redirect_rules": ["rule_id_3"]
  }
}

// Response 202
{
  "task_id": "uuid",
  "total": 6,
  "message": "Task created successfully"
}
```

#### SSE 进度推送

```
// GET /api/v1/tasks/{task_id}/stream
// Headers: Accept: text/event-stream

// 进度事件
event: progress
data: {"current": 1, "total": 10, "domain": "a.com", "status": "success", "message": "DNS record created"}

event: progress
data: {"current": 2, "total": 10, "domain": "b.com", "status": "error", "message": "Zone not found"}

// 心跳保活
event: heartbeat
data: {"timestamp": "2024-01-01T00:00:00Z"}

// 完成事件
event: complete
data: {"success": 8, "failed": 2, "cancelled": 0, "duration": 15.6}
```

### 5.3 错误响应格式

```typescript
// 统一错误响应
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数验证失败",
    "details": [
      {"field": "email", "message": "邮箱格式不正确"}
    ]
  }
}

// 错误码列表
// 400 - VALIDATION_ERROR: 参数验证错误
// 401 - UNAUTHORIZED: 未授权
// 403 - FORBIDDEN: 禁止访问
// 404 - NOT_FOUND: 资源不存在
// 409 - CONFLICT: 资源冲突
// 429 - RATE_LIMITED: 请求过于频繁
// 500 - INTERNAL_ERROR: 服务器内部错误
// 503 - SERVICE_UNAVAILABLE: 服务不可用
```

---

## 六、核心模块设计

### 6.1 批量任务引擎

```mermaid
flowchart TD
    A[接收批量请求] --> B[验证请求参数]
    B --> C{验证通过?}
    C -->|否| D[返回错误]
    C -->|是| E[检查用户积分/配额]
    E --> F{配额充足?}
    F -->|否| G[返回配额不足]
    F -->|是| H[创建任务ID]
    H --> I[任务入队 Redis]
    I --> J[返回 task_id]
    J --> K[客户端建立 SSE 连接]
    
    subgraph executor [任务执行器]
        L[从队列取任务项] --> M[执行单条操作]
        M --> N{检查结果}
        N -->|成功| O[记录成功]
        N -->|失败| P{是否致命错误}
        P -->|是| Q[中止任务]
        P -->|否| R[记录失败]
        O --> S[扣减积分]
        R --> S
        S --> T[更新进度到 Redis]
        T --> U[推送 SSE 事件]
        U --> V{还有任务项?}
        V -->|是| L
        V -->|否| W[推送完成事件]
    end
```

#### 关键设计点

**1. 限流策略**
- Cloudflare API 限制：1200 requests/5min (即 4 req/s)
- 使用令牌桶算法实现限流
- 每个账号独立限流，避免相互影响
- 遇到 429 错误自动指数退避重试

**2. 错误分类与处理**

| 错误类型 | 处理方式 | 示例 |
|----------|----------|------|
| 致命错误 | 立即中止整个任务 | 凭据无效、权限不足 |
| 可跳过错误 | 记录错误继续执行 | 域名不存在、记录已存在 |
| 可重试错误 | 自动重试(最多3次) | 网络超时、429限流 |

**3. 并发控制**
- 同一账号串行执行（避免触发限流）
- 不同账号可并行执行
- 最大并发账号数可配置（默认 5）

### 6.2 Cloudflare 客户端封装

```python
# services/cloudflare/client.py
import asyncio
import httpx
from typing import Optional, Dict, Any
from app.core.rate_limiter import RateLimiter

class CloudflareClient:
    """Cloudflare API 客户端封装"""
    
    BASE_URL = "https://api.cloudflare.com/client/v4"
    
    def __init__(self, credential_type: str, credentials: dict):
        self.credential_type = credential_type
        self.credentials = credentials
        self.rate_limiter = RateLimiter(rate=4, per=1)  # 4 req/s
        
    def _get_auth_headers(self) -> Dict[str, str]:
        """获取认证头"""
        if self.credential_type == "api_token":
            return {"Authorization": f"Bearer {self.credentials['api_token']}"}
        else:
            return {
                "X-Auth-Email": self.credentials["email"],
                "X-Auth-Key": self.credentials["api_key"]
            }
    
    async def request(
        self, 
        method: str, 
        path: str, 
        **kwargs
    ) -> Dict[str, Any]:
        """带限流和重试的请求"""
        await self.rate_limiter.acquire()
        
        headers = self._get_auth_headers()
        headers["Content-Type"] = "application/json"
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            for attempt in range(3):
                try:
                    response = await client.request(
                        method,
                        f"{self.BASE_URL}{path}",
                        headers=headers,
                        **kwargs
                    )
                    
                    # 处理限流
                    if response.status_code == 429:
                        wait_time = 2 ** attempt
                        await asyncio.sleep(wait_time)
                        continue
                    
                    data = response.json()
                    
                    # Cloudflare API 统一响应格式
                    if not data.get("success", False):
                        errors = data.get("errors", [])
                        raise CloudflareAPIError(errors)
                    
                    return data
                    
                except httpx.TimeoutException:
                    if attempt == 2:
                        raise
                    await asyncio.sleep(1)
    
    # Zone 操作
    async def list_zones(self, page: int = 1, per_page: int = 50):
        return await self.request(
            "GET", 
            f"/zones?page={page}&per_page={per_page}"
        )
    
    async def create_zone(self, name: str):
        return await self.request(
            "POST", 
            "/zones", 
            json={"name": name, "jump_start": True}
        )
    
    async def delete_zone(self, zone_id: str):
        return await self.request("DELETE", f"/zones/{zone_id}")
    
    # DNS 操作
    async def list_dns_records(self, zone_id: str):
        return await self.request("GET", f"/zones/{zone_id}/dns_records")
    
    async def create_dns_record(self, zone_id: str, record: dict):
        return await self.request(
            "POST", 
            f"/zones/{zone_id}/dns_records", 
            json=record
        )
    
    async def update_dns_record(self, zone_id: str, record_id: str, record: dict):
        return await self.request(
            "PATCH", 
            f"/zones/{zone_id}/dns_records/{record_id}", 
            json=record
        )
    
    async def delete_dns_record(self, zone_id: str, record_id: str):
        return await self.request(
            "DELETE", 
            f"/zones/{zone_id}/dns_records/{record_id}"
        )
    
    # Zone Settings 操作
    async def get_zone_setting(self, zone_id: str, setting_name: str):
        return await self.request(
            "GET", 
            f"/zones/{zone_id}/settings/{setting_name}"
        )
    
    async def update_zone_setting(self, zone_id: str, setting_name: str, value: Any):
        return await self.request(
            "PATCH", 
            f"/zones/{zone_id}/settings/{setting_name}", 
            json={"value": value}
        )
```

### 6.3 API 凭据加密

```python
# core/encryption.py
import json
from cryptography.fernet import Fernet
from app.config import settings

class CredentialEncryption:
    """API 凭据加密存储"""
    
    def __init__(self):
        self.fernet = Fernet(settings.ENCRYPTION_KEY.encode())
    
    def encrypt(self, credentials: dict) -> str:
        """加密凭据"""
        data = json.dumps(credentials).encode()
        return self.fernet.encrypt(data).decode()
    
    def decrypt(self, encrypted: str) -> dict:
        """解密凭据"""
        data = self.fernet.decrypt(encrypted.encode())
        return json.loads(data)

# 使用单例
credential_encryption = CredentialEncryption()
```

### 6.4 限流器实现

```python
# core/rate_limiter.py
import asyncio
import time
from collections import deque

class RateLimiter:
    """令牌桶限流器"""
    
    def __init__(self, rate: int, per: float):
        """
        Args:
            rate: 每个时间窗口允许的请求数
            per: 时间窗口大小（秒）
        """
        self.rate = rate
        self.per = per
        self.tokens = rate
        self.last_update = time.monotonic()
        self._lock = asyncio.Lock()
    
    async def acquire(self):
        """获取一个令牌，如果没有令牌则等待"""
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self.last_update
            
            # 补充令牌
            self.tokens = min(
                self.rate, 
                self.tokens + elapsed * (self.rate / self.per)
            )
            self.last_update = now
            
            if self.tokens < 1:
                # 计算需要等待的时间
                wait_time = (1 - self.tokens) * (self.per / self.rate)
                await asyncio.sleep(wait_time)
                self.tokens = 0
            else:
                self.tokens -= 1
```

### 6.5 SSE 事件推送

```python
# services/task_engine.py
import asyncio
import json
import uuid
from typing import AsyncGenerator
from sse_starlette.sse import EventSourceResponse
from redis.asyncio import Redis

class TaskEngine:
    """批量任务执行引擎"""
    
    def __init__(self, redis: Redis):
        self.redis = redis
    
    async def create_task(
        self, 
        task_type: str, 
        items: list, 
        metadata: dict
    ) -> str:
        """创建任务"""
        task_id = str(uuid.uuid4())
        
        # 存储任务状态
        await self.redis.hset(f"task:{task_id}", mapping={
            "status": "pending",
            "type": task_type,
            "total": len(items),
            "current": 0,
            "success": 0,
            "failed": 0,
            "metadata": json.dumps(metadata)
        })
        await self.redis.expire(f"task:{task_id}", 86400)  # 24h
        
        # 存储任务项
        for item in items:
            await self.redis.rpush(
                f"task:{task_id}:items", 
                json.dumps(item)
            )
        await self.redis.expire(f"task:{task_id}:items", 86400)
        
        return task_id
    
    async def execute_task(
        self, 
        task_id: str, 
        executor_func
    ) -> AsyncGenerator[dict, None]:
        """执行任务并生成进度事件"""
        
        # 更新状态为运行中
        await self.redis.hset(f"task:{task_id}", "status", "running")
        
        total = int(await self.redis.hget(f"task:{task_id}", "total"))
        current = 0
        success_count = 0
        failed_count = 0
        
        while True:
            # 获取下一个任务项
            item_data = await self.redis.lpop(f"task:{task_id}:items")
            if not item_data:
                break
            
            item = json.loads(item_data)
            current += 1
            
            try:
                # 执行单条操作
                result = await executor_func(item)
                success_count += 1
                
                yield {
                    "event": "progress",
                    "data": {
                        "current": current,
                        "total": total,
                        "domain": item.get("domain"),
                        "status": "success",
                        "message": result.get("message", "Success")
                    }
                }
                
            except FatalError as e:
                # 致命错误，中止任务
                failed_count += 1
                yield {
                    "event": "progress",
                    "data": {
                        "current": current,
                        "total": total,
                        "domain": item.get("domain"),
                        "status": "error",
                        "message": str(e),
                        "fatal": True
                    }
                }
                break
                
            except Exception as e:
                # 非致命错误，继续执行
                failed_count += 1
                yield {
                    "event": "progress",
                    "data": {
                        "current": current,
                        "total": total,
                        "domain": item.get("domain"),
                        "status": "error",
                        "message": str(e)
                    }
                }
            
            # 更新 Redis 中的进度
            await self.redis.hset(f"task:{task_id}", mapping={
                "current": current,
                "success": success_count,
                "failed": failed_count
            })
        
        # 任务完成
        await self.redis.hset(f"task:{task_id}", "status", "completed")
        
        yield {
            "event": "complete",
            "data": {
                "success": success_count,
                "failed": failed_count,
                "total": total
            }
        }
```

---

## 七、安全设计

### 7.1 认证方案

#### JWT Token 认证

```python
# core/security.py
from datetime import datetime, timedelta
from jose import jwt, JWTError
from passlib.context import CryptContext
from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def create_access_token(user_id: str) -> str:
    """创建访问令牌"""
    expire = datetime.utcnow() + timedelta(minutes=15)
    payload = {
        "sub": user_id,
        "exp": expire,
        "type": "access"
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")

def create_refresh_token(user_id: str) -> str:
    """创建刷新令牌"""
    expire = datetime.utcnow() + timedelta(days=7)
    payload = {
        "sub": user_id,
        "exp": expire,
        "type": "refresh"
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")

def verify_token(token: str, token_type: str = "access") -> str:
    """验证令牌并返回用户ID"""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
        if payload.get("type") != token_type:
            raise JWTError("Invalid token type")
        return payload.get("sub")
    except JWTError:
        raise InvalidTokenError()

def hash_password(password: str) -> str:
    """哈希密码"""
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码"""
    return pwd_context.verify(plain_password, hashed_password)
```

#### Token 存储策略

| Token 类型 | 存储位置 | 有效期 | 用途 |
|------------|----------|--------|------|
| Access Token | 前端内存/LocalStorage | 15 分钟 | API 请求认证 |
| Refresh Token | HttpOnly Cookie | 7 天 | 刷新 Access Token |

### 7.2 安全措施

| 措施 | 实现方式 |
|------|----------|
| HTTPS | Nginx 反向代理，强制 HTTPS 重定向 |
| 密码存储 | bcrypt 哈希，cost factor = 12 |
| API 凭据存储 | Fernet 对称加密（AES-128-CBC） |
| CSRF 防护 | SameSite=Strict Cookie + CSRF Token |
| XSS 防护 | Content-Security-Policy + 输入转义 |
| 速率限制 | 基于 IP 和用户的双重限流 |
| 输入验证 | Pydantic (后端) + Zod (前端) 双重验证 |
| SQL 注入防护 | SQLAlchemy ORM 参数化查询 |
| 敏感日志脱敏 | API 凭据、密码等不记录到日志 |

### 7.3 速率限制规则

| 端点类型 | 限制 | 窗口 |
|----------|------|------|
| 认证接口 | 5 次 | 1 分钟 |
| 普通 API | 100 次 | 1 分钟 |
| 批量操作 | 10 次 | 1 分钟 |
| SSE 连接 | 5 个 | 同时 |

---

## 八、部署方案

### 8.1 Docker Compose 架构

```yaml
# docker-compose.yml
version: '3.8'

services:
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      - NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
    depends_on:
      - backend
    networks:
      - cf-toolkit-network

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      - DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${JWT_SECRET}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - RESEND_API_KEY=${RESEND_API_KEY}
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
      - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - cf-toolkit-network

  postgres:
    image: postgres:15-alpine
    restart: unless-stopped
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=${DB_NAME}
      - POSTGRES_USER=${DB_USER}
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - cf-toolkit-network

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - cf-toolkit-network

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./docker/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./docker/nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - frontend
      - backend
    networks:
      - cf-toolkit-network

volumes:
  postgres_data:
  redis_data:

networks:
  cf-toolkit-network:
    driver: bridge
```

### 8.2 开发环境配置

```yaml
# docker-compose.dev.yml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    ports:
      - "5432:5432"
    volumes:
      - postgres_dev_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=cf_toolkit_dev
      - POSTGRES_USER=dev
      - POSTGRES_PASSWORD=dev123

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_dev_data:/data

volumes:
  postgres_dev_data:
  redis_dev_data:
```

### 8.3 Nginx 配置

```nginx
# docker/nginx/nginx.conf
events {
    worker_connections 1024;
}

http {
    upstream frontend {
        server frontend:3000;
    }
    
    upstream backend {
        server backend:8000;
    }
    
    # HTTP -> HTTPS 重定向
    server {
        listen 80;
        server_name _;
        return 301 https://$host$request_uri;
    }
    
    server {
        listen 443 ssl http2;
        server_name _;
        
        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
        
        # 前端
        location / {
            proxy_pass http://frontend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }
        
        # 后端 API
        location /api/ {
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            
            # SSE 支持
            proxy_buffering off;
            proxy_cache off;
            proxy_read_timeout 3600s;
        }
    }
}
```

### 8.4 环境变量模板

```env
# .env.example

# ===================
# 数据库配置
# ===================
DB_NAME=cf_toolkit
DB_USER=cftools
DB_PASSWORD=your_secure_password_here

# ===================
# Redis 配置
# ===================
REDIS_URL=redis://redis:6379

# ===================
# 安全配置
# ===================
# JWT 密钥 (使用 openssl rand -hex 32 生成)
JWT_SECRET=your_jwt_secret_key_here

# 加密密钥 (使用 python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" 生成)
ENCRYPTION_KEY=your_fernet_key_here

# ===================
# 外部服务
# ===================
# Resend 邮件服务
RESEND_API_KEY=re_xxxxx

# Google OAuth
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxx

# ===================
# 应用配置
# ===================
# 前端 API 地址
NEXT_PUBLIC_API_URL=https://api.yourdomain.com

# 应用环境
NODE_ENV=production
PYTHON_ENV=production
```

### 8.5 Dockerfile 示例

**前端 Dockerfile**
```dockerfile
# frontend/Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000

CMD ["node", "server.js"]
```

**后端 Dockerfile**
```dockerfile
# backend/Dockerfile
FROM python:3.11-slim

WORKDIR /app

# 安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制代码
COPY . .

# 创建非 root 用户
RUN adduser --disabled-password --gecos '' appuser
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 九、功能模块开发顺序

### 第一阶段：基础架构（预计 1 周）

1. **项目初始化**
   - 前端：创建 Next.js 项目，配置 TypeScript、Tailwind、shadcn/ui
   - 后端：创建 FastAPI 项目，配置 SQLAlchemy、Alembic
   - Docker：配置开发环境 docker-compose

2. **用户认证系统**
   - 用户注册（邮箱验证可后期完善）
   - 用户登录（JWT）
   - Google OAuth 登录
   - 密码找回

3. **操作账户管理**
   - 添加 Cloudflare API 凭据
   - 凭据验证
   - 账户列表、编辑、删除

### 第二阶段：核心功能（预计 2 周）

4. **批量任务引擎 + SSE**
   - 任务创建与队列管理
   - SSE 实时进度推送
   - 错误处理与重试机制

5. **域名管理**
   - 批量添加域名
   - 批量删除域名
   - 域名列表导出
   - 域名缓存机制

6. **DNS 管理**
   - 同值模式解析
   - 不同值模式解析
   - 站群模式解析
   - 自定义模式解析
   - 批量替换 DNS 值
   - 批量删除 DNS
   - 批量设置代理状态

### 第三阶段：扩展功能（预计 1 周）

7. **SSL/TLS 设置**
   - SSL 模式配置
   - HTTPS 相关设置
   - TLS 版本设置

8. **缓存设置**
   - 缓存级别配置
   - 浏览器缓存 TTL
   - 开发模式
   - 清除缓存

9. **传输优化设置**
   - Brotli 压缩
   - Rocket Loader
   - Early Hints
   - 其他优化项

### 第四阶段：高级功能（预计 1 周）

10. **规则克隆/删除**
    - 读取源域名规则
    - 规则选择与克隆
    - 批量删除规则
    - 支持多种规则类型

11. **其他设置**
    - Bot Fight Mode
    - AI 爬虫阻止
    - HTTP/2 to Origin
    - 其他杂项配置

12. **积分系统**
    - 积分扣减逻辑
    - 月度重置
    - 积分余额显示

### 第五阶段：完善（预计 1 周）

13. **国际化完善**
    - 中英文翻译
    - 语言切换

14. **支付集成预留**
    - 支付接口预留
    - 订阅状态管理

15. **测试和优化**
    - 单元测试
    - E2E 测试
    - 性能优化

---

## 十、附录

### 10.1 Cloudflare API 参考

| 功能 | API 端点 | 文档链接 |
|------|----------|----------|
| Zone 管理 | `/zones` | https://developers.cloudflare.com/api/operations/zones-get |
| DNS 记录 | `/zones/{zone_id}/dns_records` | https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-list-dns-records |
| Zone 设置 | `/zones/{zone_id}/settings` | https://developers.cloudflare.com/api/operations/zone-settings-get-all-zone-settings |
| Page Rules | `/zones/{zone_id}/pagerules` | https://developers.cloudflare.com/api/operations/page-rules-list-page-rules |
| Rulesets | `/zones/{zone_id}/rulesets` | https://developers.cloudflare.com/api/operations/getZoneRulesets |

### 10.2 常用 Zone Settings

| 设置项 | API 名称 | 类型 |
|--------|----------|------|
| SSL 模式 | `ssl` | enum: off, flexible, full, strict |
| 始终使用 HTTPS | `always_use_https` | on/off |
| 最低 TLS 版本 | `min_tls_version` | 1.0, 1.1, 1.2, 1.3 |
| TLS 1.3 | `tls_1_3` | on/off |
| 自动 HTTPS 重写 | `automatic_https_rewrites` | on/off |
| Brotli | `brotli` | on/off |
| 开发模式 | `development_mode` | on/off |
| 缓存级别 | `cache_level` | bypass, basic, simplified, aggressive |
| 浏览器缓存 TTL | `browser_cache_ttl` | number (seconds) |

### 10.3 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0 | 2024-01-XX | 初始版本 |

