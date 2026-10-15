import type { ApiNode, ApiEdge, RepositoryPayload } from "./api";
export const DEMO_REPOSITORY: RepositoryPayload = {
  id: "demo",
  owner: "acme",
  name: "commerce-platform",
  branch: "main",
  defaultBranch: "main",
  indexedCommitSha: "a41f8e72b90d",
  indexStatus: "READY",
  parserVersion: "1.0",
  graphSchemaVersion: 1,
  lastIndexedAt: "2026-10-15T10:00:00Z",
  error: null,
  latestJob: {
    id: "demo-job",
    kind: "INDEX",
    status: "COMPLETED",
    stage: "complete",
    progress: 100,
    filesProcessed: 8,
    filesTotal: 8,
    nodesCreated: 12,
    edgesCreated: 15,
    error: null,
  },
};
const specs = [
  ["repository", "commerce-platform", null],
  ["folder", "src", "src"],
  ["file", "storefront.tsx", "src/storefront.tsx"],
  ["component", "Storefront", "src/storefront.tsx"],
  ["component", "ProductList", "src/products.tsx"],
  ["component", "Cart", "src/cart.tsx"],
  ["hook", "useCart", "src/useCart.ts"],
  ["service", "ProductService", "src/services/products.ts"],
  ["api_endpoint", "GET /products", "src/api/products.ts"],
  ["function", "getProducts", "src/services/products.ts"],
  ["package", "database", "packages/database"],
  ["function", "queryProducts", "packages/database/index.ts"],
];
const nodes: ApiNode[] = specs.map(([nodeType, name, filePath], i) => ({
  id: `demo-${i}`,
  nodeType: nodeType!,
  name: name!,
  qualifiedName: name!,
  filePath: filePath ?? null,
  language: "typescript",
  startLine: 1,
  endLine: 12,
  metadata: {},
}));
const links: [number, number, string][] = [
  [0, 1, "CONTAINS"],
  [1, 2, "CONTAINS"],
  [2, 3, "CONTAINS"],
  [3, 4, "RENDERS"],
  [3, 5, "RENDERS"],
  [5, 6, "USES"],
  [3, 7, "IMPORTS"],
  [7, 8, "CALLS_API"],
  [8, 9, "CALLS"],
  [9, 10, "DEPENDS_ON"],
  [10, 11, "CONTAINS"],
  [9, 11, "CALLS"],
  [1, 7, "CONTAINS"],
  [1, 8, "CONTAINS"],
  [1, 10, "CONTAINS"],
];
const edges: ApiEdge[] = links.map(([a, b, edgeType], i) => ({
  id: `edge-${i}`,
  source: `demo-${a}`,
  target: `demo-${b}`,
  edgeType,
  confidence: 1,
  evidence: "Illustrative sample relationship",
  sourceFile: nodes[a]!.filePath,
  sourceLine: 1,
  extractionMethod: "sample",
}));
export function demoResponse(path: string, init?: RequestInit): unknown {
  const suffix = path
    .replace(/^\/api\/repositories\/demo\/?/, "")
    .split("?")[0];
  if (
    init?.method &&
    init.method !== "GET" &&
    !["chat", "search"].includes(suffix!)
  )
    throw new Error(
      "This sample is read-only. Connect your own repository to make changes.",
    );
  if (!suffix)
    return {
      repository: DEMO_REPOSITORY,
      latestJob: DEMO_REPOSITORY.latestJob,
    };
  if (suffix === "graph")
    return {
      scope: "full",
      nodes,
      edges,
      truncated: false,
      counts: { nodes: nodes.length, edges: edges.length },
    };
  if (suffix === "architecture")
    return {
      counts: { nodes: 12, edges: 15 },
      routes: [
        { path: "/", kind: "page" },
        { path: "/products", kind: "page" },
        { path: "/cart", kind: "page" },
      ],
      endpoints: [
        { label: "GET /products", method: "GET", path: "/api/products" },
      ],
      services: [
        { name: "ProductService", filePath: "src/services/products.ts" },
      ],
      packages: ["database"],
      graphVersion: {
        commit: DEMO_REPOSITORY.indexedCommitSha,
        parserVersion: "1.0",
        graphSchemaVersion: 1,
      },
      projectManifest: {
        projectType: "Next.js application",
        packageManager: "npm",
        lockfile: "package-lock.json",
        name: "commerce-platform",
        scripts: [{ name: "dev", command: "next dev" }],
        runtime: [
          {
            name: "next",
            version: "15",
            dev: false,
            category: "App framework",
          },
          {
            name: "react",
            version: "19",
            dev: false,
            category: "UI & styling",
          },
        ],
        dev: [],
        workspaces: [],
        manifests: 1,
        empty: false,
      },
    };
  if (suffix === "suggestions")
    return {
      suggestions: [
        "How does the storefront load products?",
        "What depends on ProductService?",
        "How is the cart connected?",
      ],
      source: "sample",
      counts: { nodes: 12, edges: 15 },
    };
  if (suffix === "search") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    return {
      results: nodes
        .filter((n) =>
          n.name.toLowerCase().includes(String(body.query ?? "").toLowerCase()),
        )
        .map((n) => ({ ...n, nodeId: n.id, score: 1 })),
    };
  }
  if (suffix === "chat")
    return {
      answer:
        "In this sample codebase, Storefront renders ProductList and Cart. ProductService calls GET /products, which delegates to getProducts and then queryProducts in the database package. The cart uses the useCart hook for its state. This is an illustrative walkthrough using sample data; connect a repository for answers grounded in your own source.",
      references: [
        {
          nodeId: "demo-3",
          filePath: "src/storefront.tsx",
          startLine: 1,
          endLine: 12,
          symbol: "Storefront",
          snippet: "export function Storefront() { return <ProductList />; }",
        },
      ],
      relationships: [
        { from: "Storefront", relationship: "RENDERS", to: "ProductList" },
      ],
      canvasPath: ["demo-3", "demo-7", "demo-8", "demo-9"],
      confidence: 1,
      partial: false,
      unverified: false,
    };
  if (suffix?.startsWith("nodes/")) {
    const node = nodes.find((n) => n.id === suffix.split("/")[1]) ?? nodes[0]!;
    if (suffix.endsWith("/neighborhood"))
      return { nodes, edges, truncated: false };
    return {
      node,
      outgoing: edges.filter((e) => e.source === node.id),
      incoming: edges.filter((e) => e.target === node.id),
      neighbors: nodes.filter((n) =>
        edges.some(
          (e) =>
            (e.source === node.id && e.target === n.id) ||
            (e.target === node.id && e.source === n.id),
        ),
      ),
      evidence: node.filePath
        ? {
            filePath: node.filePath,
            startLine: 1,
            endLine: 3,
            snippet:
              "// Illustrative sample source\nexport function " +
              node.name.replace(/\W/g, "") +
              "() {\n  return null;\n}",
          }
        : null,
    };
  }
  if (suffix === "paths")
    return { found: true, nodes, edges, length: edges.length };
  if (suffix === "index")
    return { repository: DEMO_REPOSITORY, job: DEMO_REPOSITORY.latestJob };
  if (suffix === "prs")
    return {
      pullRequests: [
        {
          id: "sample-pr",
          number: 42,
          title: "Add product filtering to the storefront",
          author: "alex",
          status: "OPEN",
          state: "open",
          headSha: "a41f8e7",
          updatedAt: "2026-10-15T10:00:00Z",
          baseBranch: "main",
          headBranch: "feature/product-filters",
          review: {
            id: "sample-review",
            status: "COMPLETED",
            headSha: "a41f8e7",
            findings: 0,
            aiStatus: "COMPLETED",
            inlineComments: 0,
            summaryCommentId: null,
            commentErrors: [],
            error: null,
            startedAt: "2026-10-15T10:00:00Z",
            completedAt: "2026-10-15T10:01:00Z",
          },
        },
      ],
      commentCapability: {
        mode: "anonymous",
        canComment: false,
        appConfigured: false,
        requiresInstall: false,
        message:
          "Sample workspace. Connect a repository to run and publish reviews.",
        installUrl: null,
        appSettingsUrl: null,
      },
    };
  if (suffix === "findings") return { findings: [] };
  if (suffix?.includes("reviews"))
    return { reviews: [], jobs: [], active: false };
  throw new Error("This action is unavailable in the sample workspace.");
}
