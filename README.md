# shanjitong-search-backend (Free deploy starter)

独立的 Node.js 搜索 API，不需要 PostgreSQL 或其他付费数据库。适合先在 Render Free 验证部署。

## Render 部署设置
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`
- Plan: Free（创建前请在 Render 界面再次确认费用）

也可用 Blueprint 读取 `render.yaml`。不要把本工程提交到现有 `shanjitong-ai` 仓库；请新建独立 GitHub 仓库。

## 接口
- `GET /health`：健康检查
- `GET /api/search?q=关键词&limit=10`：搜索已收录页面
- `POST /api/pages`：收录/更新页面，需 `X-Admin-Key` 请求头
- `GET /api/stats`：查看数量，需 `X-Admin-Key`
- `POST /api/instant`：安全算术表达式计算，例如 `{"q":"2^3 + 4"}`

### 收录页面示例
```sh
curl -X POST https://你的服务.onrender.com/api/pages \
  -H 'Content-Type: application/json' \
  -H 'X-Admin-Key: 你的ADMIN_API_KEY' \
  -d '{"url":"https://example.com/guide","title":"指南","description":"示例摘要","text":"这是供搜索的示例内容"}'
```

### 搜索示例
```sh
curl 'https://你的服务.onrender.com/api/search?q=示例'
```

## 重要限制
此 Free 版把索引保存在进程内存中：服务重启、休眠后重新启动或重新部署后，已收录页面会清空。它不会创建数据库，也不能作为永久数据存储。需要长期保存时，再接入经确认免费的持久化数据库。

首次部署后，在 Render 环境变量中确认 `ADMIN_API_KEY` 已生成。不要把管理员密钥写入网页前端或公开仓库。
