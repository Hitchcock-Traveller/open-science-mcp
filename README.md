# Open Science MCP (Cloudflare Workers 版)

免费、全球边缘节点、国内访问快、每天10万次请求免费额度。

## 部署

### 方法一：Wrangler CLI（推荐）
```bash
npx wrangler login
npx wrangler deploy
```

### 方法二：通过 GitHub Actions
推送后自动部署，需要配置 Cloudflare API Token 到 GitHub Secrets。

## 扣子注册

部署后获得：`https://open-science-mcp.your-account.workers.dev`

- **名称**: `open-science`
- **URL**: `https://open-science-mcp.your-account.workers.dev/mcp`
- **传输模式**: Streamable HTTP

## 8个科研工具

OpenAlex (搜索/详情/被引)、arXiv、PubMed、DOI、Zenodo、CrossRef
