# CF批量工具箱 完整功能分析

## 一、网站概述

CF批量工具箱是一个面向站长/运维的**第三方批量管理面板**，核心价值是把 Cloudflare 里原本需要逐个点击的操作，变成"选账号 + 粘贴域名/规则/记录"后一键批量执行。

**目标用户**：站群运营者、SEO从业者、拥有大量域名需要统一管理的企业/个人

---

## 二、用户功能概览（按用户旅程）

### 1. 访客可用（未登录）

- 浏览首页与功能介绍（Cloudflare 批量工具入口、订阅计划说明）
- 语言切换（中文/English）
- 查看教程指引文章（批量添加域名/批量删除域名/批量解析 DNS）
- 查看页脚联系方式（Telegram、邮箱）
- 访问登录/注册/忘记密码入口

### 2. 账号与安全

- 邮箱+密码注册、登录（含"记住我"）
- Google 第三方登录
- 忘记密码：提交邮箱获取重置链接并重设密码
- 注册限制：昵称不能包含大写字母

### 3. 操作账户管理（核心前置）

- 统一的"操作账户"概念：选择要操作的 Cloudflare 账号
- 管理操作账户入口：`/zh_CN/user/sp_accounts`（添加/管理服务商 API 凭据）
- 域名列表缓存管理：支持"更新缓存"刷新站点侧域名清单

### 4. 域名输入辅助（通用能力）

- **读取域名列表弹窗**：分页展示账号下域名，快速勾选回填到输入框
- **全选/更新缓存**等快捷操作，减少手工粘贴成本
- 切换操作账户会清空当前输入与列表，避免误操作

### 5. 批量执行与结果管理（通用能力）

- 一键开始批量执行：按"每条域名/每条记录"显示执行进度与结果
- 统一的错误弹窗提示与整体中止机制（遇到特定错误停止后续请求）
- 结果表格**导出 CSV**（各功能页基本都支持）
- 页面提示：请不要刷新或关闭页面，否则任务会被终止

### 6. 订阅与额度

| 计划 | 价格 | 说明 |
|------|------|------|
| 免费 | 0 | 每月重置1000积分（约100次请求，成功失败都消耗） |
| 1年订阅 | 29.9 USDT | 无限制使用 |

---

## 三、功能详解

### A. Cloudflare 批量工具（14个功能）

#### 1. 域名管理

| 功能 | 路径 | 说明 |
|------|------|------|
| 批量添加域名 | `/cloudflare/domainadd` | 输入域名列表批量创建 Zone，返回 NS 服务器信息 |
| 批量删除域名 | `/cloudflare/domaindel` | 支持手填或从列表选择；可一键"列出未激活域名"批量清理 |
| 域名导出 | `/cloudflare/domainexport` | 按账号导出域名清单与创建时间（CSV） |
| 任务托管（测试） | `/cloudflare/tasks` | 服务端队列执行添加域名，单次最多100个 |

#### 2. DNS 记录管理

| 功能 | 路径 | 说明 |
|------|------|------|
| 批量解析 DNS | `/cloudflare/recordadd` | 4种模式，支持 TTL、代理状态、冲突处理 |
| 批量替换 DNS 值 | `/cloudflare/recordrep` | 按"原值→新值"跨域名替换，显示替换数量 |
| 批量删除 DNS | `/cloudflare/recorddel` | 3种模式：按记录+类型 / 清空 / 自定义 |
| 批量设置代理状态 | `/cloudflare/proxied_record` | 对指定记录（支持 @all）批量开/关代理 |

**DNS 解析 4 种模式详解：**

| 模式 | 说明 | 格式示例 |
|------|------|----------|
| 同值模式 | 所有域名解析到相同值 | 直接输入记录值 |
| 不同值模式 | 域名与记录值一一对应 | `域名\|记录值` |
| 站群模式 | 域名轮询分配IP，不够则循环 | 多个IP轮询分配 |
| 自定义模式 | 最灵活，可设不同记录类型 | `域名\|DNS记录\|记录类型\|记录值` |

**支持的记录类型**：A / AAAA / CNAME / TXT / NS / MX

#### 3. SSL/TLS/HTTPS 设置

| 功能项 | 可选值 |
|--------|--------|
| 自动 SSL/TLS | 开/关 |
| SSL加密模式 | off / flexible / full / strict / origin_pull |
| 始终使用 HTTPS | 开/关 |
| 最低 TLS 版本 | TLS 1.0 / 1.1 / 1.2 / 1.3 |
| 随机加密 | 开/关 |
| TLS 1.3 | 开/关 |
| 自动 HTTPS 重写 | 开/关 |

#### 4. 缓存管理

| 功能项 | 说明 |
|--------|------|
| 清除缓存 | purge_cache |
| 缓存级别 | 无URI参数 / 忽略URI参数 / 标准 |
| 浏览器缓存 TTL | 多档下拉 |
| Tiered Cache | 开/关 |
| Always Online | 开/关 |
| 开发模式 | 开/关 |

#### 5. 传输优化/代码压缩

| 功能项 | 说明 |
|--------|------|
| Brotli 压缩 | 开/关 |
| Rocket Loader | 开/关 |
| Speed Brain | 开/关 |
| Cloudflare Fonts | 开/关 |
| Early Hints | 资源预加载 |
| 0-RTT | 连接恢复 |
| Polish | 图片压缩（Pro+） |
| Mirage | 图片优化（Pro+） |

#### 6. 规则管理

**批量克隆规则** `/cloudflare/rules`：从源域名读取规则，复制到目标域名列表

| 支持的规则类型 |
|----------------|
| Configuration Rules |
| Transform Rules（URL重写/请求头/响应头） |
| Redirect Rules |
| Origin Rules |
| Cache Rules |
| Page Rules（自动替换域名） |
| WAF 自定义规则 |
| WAF 速率限制规则 |
| WAF DDoS L7 |

**批量删除规则** `/cloudflare/rules_del`：清空指定类型的全部规则

#### 7. 其他设置/杂项

| 功能项 | 说明 |
|--------|------|
| Crawler Hints | 爬虫提示 |
| Bot Fight Mode | 自动程序攻击模式 |
| AI 爬虫阻止 | block / only_on_ad_pages / disabled |
| AI 迷宫 | crawler_protection |
| Managed robots.txt | 托管 robots.txt |
| HTTP/2 to Origin | 到源服务器 HTTP/2 |
| URL 标准化 | none / incoming |
| Web Analytics | speculation |
| **基本功能批量设置** | HTTP/3、WebSocket、Browser Check、Hotlink 保护等多项一次提交 |

---

## 四、技术实现

### 1. 前端技术栈

- 服务端渲染页面 + 页面内联 jQuery 脚本
- 组件/交互：Alpine.js（x-data/x-show/x-transition）
- 样式：Tailwind CSS
- 构建：Vite（build/assets/app-*.css/js）
- 弹窗：SweetAlert2（Swal.fire）
- 剪贴板：clipboard.min.js

### 2. 会话与安全

- CSRF 保护：`<meta name="csrf-token">` + XSRF-TOKEN cookie
- AJAX 统一带 CSRF header
- 会话 cookie 管理

### 3. API 结构

**域名列表 API：**

```
GET /zh_CN/api/v1/domain?sp=cloudflare&aid={账号ID}&page={页码}
```

返回 Laravel 风格分页结构（data + links）

**批量执行 API（按功能）：**

```
POST /zh_CN/cloudflare/{功能}/api
```

**统一返回结构：**

```json
{
  "status": 200,
  "msg": "成功/失败信息",
  "data": {...}
}
```

**特殊状态码：**

- `410`：权限/额度/订阅不足，前端会 abort() 取消所有未完成请求并弹窗
- `500`：部分页面也会整体 abort

### 4. 批量执行机制

- **前端并行发请求**：把任务拆成多行，对每行发一次 AJAX
- 非后端队列，任务在浏览器生命周期内执行
- 容易触发 Cloudflare 的速率限制
- 站点在添加/删除域名页明确提示 Cloudflare rate limit 错误

### 5. 域名缓存机制

- 站点后端维护"域名缓存表"
- `POST /zh_CN/user/sp_accounts/refresh_domain/{accountId}` 刷新缓存
- 减少实时调用服务商 API 的次数

---

## 五、关键观察

1. **速率限制风险**：批量执行是浏览器端并行 N 个请求，容易触发 Cloudflare 限制
2. **任务托管**为实验功能：仅"添加域名"支持服务端队列执行，其他功能仍依赖前端
3. **规则克隆**是高级功能：不仅批量设置，还能从源域名读取→选择→复制到多个目标
4. **积分消耗**：无论成功失败都扣，免费用户需谨慎测试
