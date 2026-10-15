import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
// @ts-ignore
import { TOOLS } from "../../lib/tools.js";

const server = new McpServer({
  name: "open-science-mcp",
  version: "1.0.0",
});

for (const tool of TOOLS) {
  // @ts-ignore
  server.tool(tool.name, tool.description, tool.schema, async (args) => {
    try {
      const result = await tool.handler(args || {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `错误: ${err.message}` }],
        isError: true,
      };
    }
  });
}

export default async (request: Request) => {
  const url = new URL(request.url);
  
  // 健康检查
  if (url.pathname === "/health") {
    return new Response(JSON.stringify({
      status: "ok",
      server: "open-science-mcp",
      tools: TOOLS.length,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // MCP Streamable HTTP
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  await server.connect(transport);
  // @ts-ignore
  return transport.handleRequest(request);
};

export const config = { path: "/mcp" };
