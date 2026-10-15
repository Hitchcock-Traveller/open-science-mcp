# Open Science MCP Server

为扣子 (Coze) 定制的科研 MCP 服务，封装 8 个核心学术数据接口。

## 工具列表

| 工具名 | 功能 | 数据源 |
|--------|------|--------|
| `openalex_search_works` | 学术论文搜索 | OpenAlex (2.5亿+篇) |
| `openalex_get_work` | 论文详情 | OpenAlex |
| `openalex_get_citations` | 被引查询 | OpenAlex |
| `arxiv_search` | 预印本搜索 | arXiv |
| `pubmed_search` | 生物医学文献 | PubMed/NCBI |
| `doi_lookup` | DOI 元数据 | CrossRef |
| `zenodo_search` | 数据集/预印本 | Zenodo |
| `crossref_search` | 文献引用搜索 | CrossRef |

## 快速部署

### Render.com (推荐，免费)
1. Fork 本仓库
2. 前往 [render.com](https://render.com) → New Web Service
3. 连接 GitHub 仓库
4. Build: `npm install` / Start: `node src/server-streamable.js`
5. 部署后获得公网 URL，如 `https://open-science-mcp.onrender.com`

### 本地运行
```bash
npm install
npm start
# 服务在 http://localhost:10000
```

## 在扣子中注册

部署后，在扣子 Agent 设置中添加自定义 MCP：
- 名称: `open-science`
- URL: `https://your-app.onrender.com/mcp`
- 传输模式: Streamable HTTP

## 端点

- `GET /health` - 健康检查
- `POST /mcp` - MCP Streamable HTTP 端点

## 协议

Apache 2.0
