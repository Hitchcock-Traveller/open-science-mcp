/**
 * 文献检索工具集 — 基于 Open-Science 同款数据源封装
 * 数据源：OpenAlex, arXiv, PubMed, DOI/CrossRef, Zenodo
 */

const { z } = require("zod");

const OPENALEX_API = "https://api.openalex.org";
const ARXIV_API = "https://export.arxiv.org/api/query";
const PUBMED_API = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const ZENODO_API = "https://zenodo.org/api";
const DOI_API = "https://api.crossref.org/works";

const USER_AGENT = "open-science-mcp/1.0 (mailto:open-science@example.com)";

async function fetchJSONWithRetry(url, options = {}, retries = 3, delayMs = 1000) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fetchJSON(url, options);
    } catch (e) {
      lastError = e;
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

async function fetchText(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { "User-Agent": USER_AGENT, ...options.headers },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.text();
}

function invertedIndexToText(inverted) {
  const positions = [];
  for (const [word, indices] of Object.entries(inverted)) {
    for (const idx of indices) {
      positions[idx] = word;
    }
  }
  return positions.join(" ");
}

// ─── 1. OpenAlex 论文搜索 ───
async function openalex_search_works(args) {
  const { query, author, year_from, year_to, max_results = 20, sort = "relevance_score:desc" } = args;
  const params = new URLSearchParams();
  if (query) params.set("search", query);
  if (author) params.set("filter", `authorships.author.display_name.search:${author}`);
  const filterParts = [];
  if (year_from || year_to) {
    filterParts.push(`publication_year:${year_from || "*"}-${year_to || "*"}`);
  }
  if (filterParts.length > 0) {
    const existing = params.get("filter");
    params.set("filter", existing ? `${existing},${filterParts.join(",")}` : filterParts.join(","));
  }
  params.set("per_page", String(Math.min(max_results, 200)));
  params.set("sort", sort);

  const data = await fetchJSON(`${OPENALEX_API}/works?${params}`);
  const results = (data.results || []).map((w) => ({
    id: w.id,
    doi: w.doi,
    title: w.title,
    authors: (w.authorships || []).map((a) => a.author?.display_name).filter(Boolean).join(", "),
    year: w.publication_year,
    journal: w.primary_location?.source?.display_name || null,
    citations: w.cited_by_count,
    type: w.type,
    open_access: w.open_access?.oa_status || null,
    abstract: w.abstract_inverted_index ? invertedIndexToText(w.abstract_inverted_index) : null,
  }));
  return { total: data.meta?.count || 0, returned: results.length, results };
}

// ─── 2. OpenAlex 单篇论文详情 ───
async function openalex_get_work(args) {
  const { doi, openalex_id } = args;
  const id = openalex_id || doi;
  if (!id) throw new Error("需要 openalex_id 或 doi");
  const path = openalex_id ? `W${openalex_id.replace(/^W/, "")}` : `doi:${doi}`;
  const w = await fetchJSON(`${OPENALEX_API}/works/${encodeURIComponent(path)}`);
  return {
    id: w.id,
    doi: w.doi,
    title: w.title,
    abstract: w.abstract_inverted_index ? invertedIndexToText(w.abstract_inverted_index) : null,
    authors: (w.authorships || []).map((a) => ({
      name: a.author?.display_name,
      orcid: a.author?.orcid,
      institutions: (a.institutions || []).map((i) => i.display_name).join(", "),
    })),
    year: w.publication_year,
    journal: w.primary_location?.source?.display_name || null,
    citations: w.cited_by_count,
    references_count: w.referenced_works_count,
    concepts: (w.concepts || []).slice(0, 10).map((c) => ({ name: c.display_name, score: c.score })),
    topics: (w.topics || []).slice(0, 5).map((t) => t.display_name),
    open_access: { status: w.open_access?.oa_status, url: w.open_access?.oa_url },
  };
}

// ─── 3. OpenAlex 被引查询 ───
async function openalex_get_citations(args) {
  const { doi, openalex_id, max_results = 20 } = args;
  const id = openalex_id || doi;
  if (!id) throw new Error("需要 openalex_id 或 doi");

  // 先获取work详情拿到正确的OpenAlex ID
  let workId = openalex_id;
  if (!workId && doi) {
    try {
      const work = await fetchJSON(`${OPENALEX_API}/works/doi:${encodeURIComponent(doi)}`);
      if (work && work.id) {
        const parts = work.id.split("/");
        workId = parts[parts.length - 1];
      }
    } catch (e) {
      throw new Error("无法获取论文详情: " + e.message);
    }
  }
  if (!workId) throw new Error("无法确定论文 OpenAlex ID");

  // 使用 cites filter 方式查询被引论文
  const data = await fetchJSON(
    `${OPENALEX_API}/works?filter=cites:${workId}&per_page=${Math.min(max_results, 200)}&sort=cited_by_count:desc`
  );
  return {
    total: data.meta?.count || 0,
    returned: data.results?.length || 0,
    citing_papers: (data.results || []).map((w) => ({
      title: w.title,
      year: w.publication_year,
      journal: w.primary_location?.source?.display_name,
      citations: w.cited_by_count,
    })),
  };
}

// ─── 4. arXiv 预印本搜索 ───
function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(re);
  return m ? m[1] : null;
}

function parseArxivAtom(xml) {
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];
    const title = extractTag(entry, "title");
    const summary = extractTag(entry, "summary");
    const published = extractTag(entry, "published");
    const updated = extractTag(entry, "updated");
    const id = extractTag(entry, "id");
    const authors = [...entry.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)].map((m) => m[1]);
    const categories = [...entry.matchAll(/category term="([^"]+)"/g)].map((m) => m[1]);
    entries.push({
      id: id?.split("/abs/")[1] || id,
      title: title?.replace(/\s+/g, " ").trim(),
      summary: summary?.replace(/\s+/g, " ").trim(),
      authors,
      published,
      updated,
      categories,
      pdf_url: id?.replace("/abs/", "/pdf/"),
    });
  }
  return entries;
}

function extractArxivTotal(xml) {
  const m = xml.match(/<opensearch:totalResults>(\d+)<\/opensearch:totalResults>/);
  return m ? parseInt(m[1], 10) : 0;
}

async function arxiv_search(args) {
  const { query, max_results = 20, start = 0, sort_by = "relevance" } = args;
  const params = new URLSearchParams();
  params.set("search_query", query || "all:*");
  params.set("start", String(start));
  params.set("max_results", String(Math.min(max_results, 100)));
  params.set("sortBy", sort_by);
  params.set("sortOrder", "descending");

  const xml = await fetchText(`${ARXIV_API}?${params}`);
  const entries = parseArxivAtom(xml);
  return { total: extractArxivTotal(xml), returned: entries.length, results: entries };
}

// ─── 5. PubMed 搜索 ───
async function pubmed_search(args) {
  const { query, max_results = 20, sort = "relevance" } = args;
  const params = new URLSearchParams({
    db: "pubmed",
    term: query,
    retmax: String(Math.min(max_results, 100)),
    retmode: "json",
    sort,
  });

  const searchData = await fetchJSONWithRetry(`${PUBMED_API}/esearch.fcgi?${params}`);
  const ids = searchData.esearchresult?.idlist || [];
  const total = parseInt(searchData.esearchresult?.count || "0", 10);

  if (ids.length === 0) return { total: 0, returned: 0, results: [] };

  const summaryParams = new URLSearchParams({
    db: "pubmed",
    id: ids.join(","),
    retmode: "json",
  });
  const summaryData = await fetchJSONWithRetry(`${PUBMED_API}/esummary.fcgi?${summaryParams}`);
  const result = summaryData.result || {};

  const papers = ids
    .map((id) => {
      const r = result[id];
      if (!r) return null;
      return {
        pmid: id,
        title: r.title,
        authors: (r.authors || []).map((a) => a.name).join(", "),
        journal: r.fulljournalname || r.source,
        pubdate: r.pubdate,
        doi: r.elocationid || null,
        pmcid: r.pmcid || null,
      };
    })
    .filter(Boolean);

  return { total, returned: papers.length, results: papers };
}

// ─── 6. DOI 查询 (CrossRef) ───
async function doi_lookup(args) {
  const { doi } = args;
  if (!doi) throw new Error("需要 doi 参数");
  const data = await fetchJSON(`${DOI_API}/${encodeURIComponent(doi)}`);
  const item = data.message;
  return {
    doi: item.DOI,
    title: item.title?.[0],
    type: item.type,
    publisher: item.publisher,
    year: item.created?.["date-parts"]?.[0]?.[0],
    authors: (item.author || []).map((a) => `${a.given || ""} ${a.family || ""}`.trim()),
    journal: item["container-title"]?.[0],
    volume: item.volume,
    issue: item.issue,
    page: item.page,
    references_count: item["is-referenced-by-count"],
    url: item.URL,
    abstract: item.abstract?.replace(/<[^>]+>/g, "") || null,
    subject: item.subject || [],
  };
}

// ─── 7. Zenodo 数据集搜索 ───
async function zenodo_search(args) {
  const { query, type, max_results = 20, sort = "bestmatch" } = args;
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("size", String(Math.min(max_results, 100)));
  params.set("sort", sort);
  if (type) params.set("type", type);

  const data = await fetchJSON(`${ZENODO_API}/records?${params}`);
  return {
    total: data.hits?.total || 0,
    returned: data.hits?.hits?.length || 0,
    results: (data.hits?.hits || []).map((r) => ({
      id: r.id,
      doi: r.doi,
      title: r.metadata?.title,
      type: r.metadata?.resource_type?.title || r.type,
      authors: (r.metadata?.creators || []).map((c) => c.name).join(", "),
      description:
        r.metadata?.description?.replace(/<[^>]+>/g, "").slice(0, 500) + "...",
      publication_date: r.metadata?.publication_date,
      access: r.metadata?.access_right,
      files_count: r.files?.length || 0,
      downloads: r.stats?.downloads,
      views: r.stats?.views,
    })),
  };
}

// ─── 8. CrossRef 搜索 ───
async function crossref_search(args) {
  const { query, max_results = 20, filter } = args;
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  params.set("rows", String(Math.min(max_results, 100)));
  if (filter) params.set("filter", filter);

  const data = await fetchJSONWithRetry(`${DOI_API}?${params}`);
  const items = data.message?.items || [];
  return {
    total: data.message?.["total-results"] || 0,
    returned: items.length,
    results: items.map((item) => ({
      doi: item.DOI,
      title: item.title?.[0],
      type: item.type,
      publisher: item.publisher,
      year: item.created?.["date-parts"]?.[0]?.[0],
      authors: (item.author || [])
        .slice(0, 5)
        .map((a) => `${a.given || ""} ${a.family || ""}`.trim()),
      journal: item["container-title"]?.[0],
      references_count: item["is-referenced-by-count"],
    })),
  };
}

// ─── 工具定义（Zod Schema） ───
const TOOLS = [
  {
    name: "openalex_search_works",
    description:
      "在 OpenAlex 中搜索学术论文。覆盖 2.5 亿+篇论文，支持全文检索、作者、年份筛选、引用排序。适合文献综述、查找某主题论文、按被引数找高影响力论文。",
    schema: {
      query: z.string().describe("关键词，搜索标题和摘要").optional(),
      author: z.string().describe("作者姓名模糊匹配").optional(),
      year_from: z.number().int().describe("起始年份（含）").optional(),
      year_to: z.number().int().describe("结束年份（含）").optional(),
      max_results: z.number().int().describe("返回数量，默认20，最大200").default(20),
      sort: z
        .enum(["relevance_score:desc", "cited_by_count:desc", "publication_date:desc", "publication_date:asc"])
        .describe("排序方式")
        .default("relevance_score:desc"),
    },
    handler: openalex_search_works,
  },
  {
    name: "openalex_get_work",
    description:
      "根据 DOI 或 OpenAlex ID 获取单篇论文完整详情：摘要、作者机构、引用数、概念标签、主题、开放获取链接。",
    schema: {
      doi: z.string().describe("论文 DOI").optional(),
      openalex_id: z.string().describe("OpenAlex Work ID").optional(),
    },
    handler: openalex_get_work,
  },
  {
    name: "openalex_get_citations",
    description:
      "获取一篇论文的被引论文列表。适合追踪论文后续研究影响、找同领域相关工作。",
    schema: {
      doi: z.string().describe("论文 DOI").optional(),
      openalex_id: z.string().describe("OpenAlex Work ID").optional(),
      max_results: z.number().int().describe("返回数量，默认20").default(20),
    },
    handler: openalex_get_citations,
  },
  {
    name: "arxiv_search",
    description:
      "在 arXiv 中搜索预印本论文。适合查找最新研究成果、追踪计算机科学/物理/数学等领域前沿。",
    schema: {
      query: z.string().describe('搜索查询，如 "ti:transformer AND cat:cs.CL"'),
      max_results: z.number().int().describe("返回数量，默认20，最大100").default(20),
      start: z.number().int().describe("分页偏移量，默认0").default(0),
      sort_by: z
        .enum(["relevance", "lastUpdatedDate", "submittedDate"])
        .describe("排序方式")
        .default("relevance"),
    },
    handler: arxiv_search,
  },
  {
    name: "pubmed_search",
    description:
      "在 PubMed 中搜索生物医学文献。适合医学、生命科学、生物信息学相关文献检索。",
    schema: {
      query: z.string().describe("PubMed 检索式，支持 MeSH 词等高级语法"),
      max_results: z.number().int().describe("返回数量，默认20，最大100").default(20),
      sort: z
        .enum(["relevance", "pub_date", "first_author", "journal"])
        .describe("排序方式")
        .default("relevance"),
    },
    handler: pubmed_search,
  },
  {
    name: "doi_lookup",
    description:
      "根据 DOI 查询 CrossRef 论文元数据：完整作者列表、期刊、卷期页码、引用数、摘要等。",
    schema: {
      doi: z.string().describe("论文 DOI"),
    },
    handler: doi_lookup,
  },
  {
    name: "zenodo_search",
    description:
      "在 Zenodo 中搜索开放数据集、预印本、软件和研究输出。适合查找科研数据集、开源代码项目。",
    schema: {
      query: z.string().describe("搜索关键词"),
      type: z
        .enum([
          "publication",
          "poster",
          "presentation",
          "dataset",
          "image",
          "video",
          "software",
          "lesson",
          "other",
        ])
        .describe("资源类型筛选")
        .optional(),
      max_results: z.number().int().describe("返回数量，默认20").default(20),
      sort: z
        .enum(["bestmatch", "mostrecent", "mostviewed", "mostcited"])
        .describe("排序方式")
        .default("bestmatch"),
    },
    handler: zenodo_search,
  },
  {
    name: "crossref_search",
    description:
      "通过 CrossRef API 搜索学术文献元数据。与 OpenAlex 互补，CrossRef 数据更全更准确。",
    schema: {
      query: z.string().describe("搜索关键词"),
      max_results: z.number().int().describe("返回数量，默认20，最大100").default(20),
      filter: z.string().describe("CrossRef 过滤条件，如 from-pub-date:2020,type:journal-article").optional(),
    },
    handler: crossref_search,
  },
];

module.exports = { TOOLS };
