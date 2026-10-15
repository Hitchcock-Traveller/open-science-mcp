/**
 * Open Science MCP Server - Streamable HTTP 模式
 * 端口: 3001 (可通过 MCP_PORT 环境变量覆盖)
 * 监听: 0.0.0.0 (可通过 MCP_HOST 环境变量覆盖)
 *
 * 端点:
 *   GET  /health  - 健康检查
 *   POST /mcp     - MCP Streamable HTTP 端点
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const http = require("http");
const { TOOLS } = require("./tools/literature.js");

const PORT = parseInt(process.env.PORT || process.env.MCP_PORT || "10000", 10);
const HOST = process.env.MCP_HOST || "0.0.0.0";

// ── 创建 MCP Server 并注册工具 ──
const server = new McpServer({
  name: "open-science-mcp",
  version: "1.0.0",
});

for (const tool of TOOLS) {
  server.tool(tool.name, tool.description, tool.schema, async (args) => {
    try {
      const result = await tool.handler(args || {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `错误: ${err.message}` }],
        isError: true,
      };
    }
  });
}

// ── 创建单个 transport 实例（stateful 模式，支持多 session）──
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
});

transport.onerror = (err) => console.error("[transport error]", err?.message || err);
transport.onclose = () => console.log("[transport] closed");

server.connect(transport).catch(err => {
  console.error("Failed to connect:", err);
  process.exit(1);
});

// ── HTTP Server ──
const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      server: "open-science-mcp",
      tools: TOOLS.length,
      uptime: process.uptime(),
    }));
    return;
  }

  if (url.pathname === "/mcp") {
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

httpServer.listen(PORT, HOST, () => {
  console.log(`Open Science MCP (streamable HTTP) on http://${HOST}:${PORT}`);
  console.log(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
  console.log(`Health: http://${HOST}:${PORT}/health`);
  console.log(`Tools (${TOOLS.length}):`);
  TOOLS.forEach(t => console.log(`  - ${t.name}`));
});
