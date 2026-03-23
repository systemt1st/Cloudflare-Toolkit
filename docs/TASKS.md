# 任务清单（实现进度）

> 说明：`[x]` 已完成，`[ ]` 未完成（或仅部分完成，备注说明）
>
> 更新时间：2025-12-18

## 0. 基础设施 / 架构

- [x] 前端：Next.js 14（App Router）+ Tailwind + next-intl 基础骨架
- [x] 后端：FastAPI + SQLAlchemy(Async) + Alembic 初始化迁移
- [x] 开发依赖：PostgreSQL/Redis（`docker-compose.dev.yml`）
- [x] 统一错误响应格式（`AppError` + 全局异常处理）
- [x] SSE 任务流（`/api/v1/tasks/{task_id}/stream`）
- [x] Cloudflare Client（限流 + 429 重试 + 统一错误封装）
- [x] 任务：取消任务（`/api/v1/tasks/{id}/cancel`）
- [x] 任务：导出任务结果 CSV（`/api/v1/tasks/{id}/export`）
- [x] 更完善的任务持久化/恢复（SSE 事件带 id + 支持断线续传）
- [x] 后端自动化测试（`backend/tests`）

## 1. 账号与安全

- [x] 邮箱注册（昵称不允许包含大写字母）
- [x] 邮箱+密码登录（返回 access token + `refresh_token` cookie）
- [x] Google 登录（前端 GIS 按钮 + 后端 tokeninfo 校验）
- [x] 获取当前用户：`GET /api/v1/users/me`
- [x] 登出：`POST /api/v1/auth/logout`
- [x] 刷新 Token：`POST /api/v1/auth/refresh`
- [x] 忘记密码/重置密码（Resend 邮件）
- [x] 修改昵称：`PATCH /api/v1/users/me`
- [x] 修改密码：`PUT /api/v1/users/me/password`

## 2. 操作账户（Cloudflare 凭据）

- [x] 操作账户 CRUD：`/api/v1/accounts`
- [x] 凭据加密存储（Fernet）
- [x] 凭据有效性验证：`POST /api/v1/accounts/{id}/verify`
- [x] 域名缓存：`GET /api/v1/accounts/{id}/domains`
- [x] 刷新域名缓存：`POST /api/v1/accounts/{id}/domains/refresh`
- [x] 前端“编辑账户”页面

## 3. 域名输入辅助（通用能力）

- [x] 域名选择弹窗（搜索/分页/全选/刷新缓存/回填输入框）
- [x] 切换操作账户自动清空输入（DNS 相关页面）
- [x] 统一的“结果导出 CSV”能力（统一封装 `exportTaskResults()`）
- [x] 更统一的“致命错误中止/提示”交互（fatal 标记 + SSE 自动重连）

## 4. 域名管理

- [x] 批量添加域名（任务托管）：`POST /api/v1/domains/add`（单次 ≤100）
- [x] 批量删除域名（任务托管）：`POST /api/v1/domains/delete`（单次 ≤100）
- [x] 未激活域名快捷填充（前端基于缓存 `status` 过滤 pending/initializing）
- [x] 域名导出 CSV：`GET /api/v1/domains/export?account_id=...`
- [x] “待激活域名”独立接口：`GET /api/v1/domains/pending?account_id=...`
- [x] 域名批量任务结果导出 CSV（`/api/v1/tasks/{id}/export`）

## 5. DNS 记录管理

- [x] 批量解析 DNS：`POST /api/v1/dns/resolve`（同值/不同值/站群/自定义）
- [x] 冲突处理：记录已存在时尝试更新（基础实现）
- [x] 批量替换 DNS 值：`POST /api/v1/dns/replace`
- [x] 批量删除 DNS：`POST /api/v1/dns/delete`（按记录/清空/自定义）
- [x] 批量设置代理状态：`POST /api/v1/dns/proxy`（`record_name` 支持 `@all`）
- [x] 更完善的冲突/匹配策略（多条同名记录、分页、更精确筛选）
- [x] DNS 功能页的任务结果导出 CSV（`/api/v1/tasks/{id}/export`）

## 6. SSL/TLS/HTTPS 设置

- [x] 批量 SSL 设置：`POST /api/v1/ssl/batch`
  - [x] `ssl_mode`
  - [x] `always_use_https`
  - [x] `min_tls_version`
- [x] `tls_1_3`
- [x] `automatic_https_rewrites`
- [x] `opportunistic_encryption`
- [x] 其它 SSL/HTTPS 相关项补齐（`universal_ssl`）
- [x] SSL 批量任务结果导出 CSV（`/api/v1/tasks/{id}/export`）

## 7. 缓存管理

- [x] 批量清除缓存（purge_cache，当前为 purge everything）
- [x] 按 URL/文件清除缓存（files 方式）
- [x] 缓存级别（cache_level）
- [x] 浏览器缓存 TTL（browser_cache_ttl）
- [x] Tiered Cache / Always Online / 开发模式

## 8. 传输优化/代码压缩（未实现）

- [x] Brotli / Rocket Loader / Speed Brain / Cloudflare Fonts（批量设置）
- [x] Early Hints / 0-RTT（批量设置）
- [x] Polish / Mirage（批量设置，可能受套餐限制）

## 9. 规则管理（未实现）

- [x] 读取源域名规则（按类型）
- [x] 克隆规则到目标域名（可选择部分规则）
- [x] 批量删除规则（按类型清空）

## 10. 其他设置/杂项（未实现）

- [x] Crawler Hints / Bot Fight Mode
- [x] AI 爬虫阻止 / AI 迷宫
- [x] Managed robots.txt
- [x] HTTP/2 to Origin / URL 标准化 / Web Analytics
- [x] 基本功能批量设置（HTTP/3、WebSocket、Browser Check、Hotlink 保护等）

## 11. 订阅/积分/限流/日志（未实现）

- [x] 免费/订阅计划（subscriptions）与到期逻辑
- [x] 积分扣减（成功/失败都消耗）与每月重置
- [x] 用户请求限流（Redis `user:{user_id}:rate_limit`）
- [x] 操作日志（operation_logs 写入/查询/展示）
- [x] 订阅/额度不足的统一错误码与前端中止机制（如文档中的 410）

## 12. 页面清单（快速入口）

- [x] 登录：`/zh/login`
- [x] 注册：`/zh/register`
- [x] 操作账户：`/zh/accounts`
- [x] 编辑账户：`/zh/accounts/{id}/edit`
- [x] 域名缓存列表：`/zh/domains`
- [x] 批量添加域名：`/zh/domains/add`
- [x] 批量删除域名：`/zh/domains/delete`
- [x] 域名导出：`/zh/domains/export`
- [x] DNS 解析：`/zh/dns/resolve`
- [x] DNS 替换：`/zh/dns/replace`
- [x] DNS 删除：`/zh/dns/delete`
- [x] DNS 代理：`/zh/dns/proxy`
- [x] SSL 批量设置：`/zh/ssl/batch`
- [x] 缓存设置：`/zh/cache/batch`
- [x] 清除缓存：`/zh/cache/purge`
- [x] 传输优化：`/zh/speed/batch`
- [x] 规则管理：`/zh/rules`
- [x] 其他设置：`/zh/other/batch`
- [x] 操作日志：`/zh/operation-logs`
- [x] 订阅/额度：`/zh/subscription`
