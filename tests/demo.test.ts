import { describe, expect, it } from "vitest";
import { demoResponse, DEMO_REPOSITORY } from "../apps/web/lib/demo";
import type {
  GraphPayload,
  SearchPayload,
  ChatPayload,
} from "../apps/web/lib/api";

describe("public sample workspace", () => {
  it("provides a coherent graph with valid relationship endpoints and matching counts", () => {
    const graph = demoResponse("/api/repositories/demo/graph") as GraphPayload;
    const ids = new Set(graph.nodes.map((node) => node.id));
    expect(graph.counts).toEqual({
      nodes: graph.nodes.length,
      edges: graph.edges.length,
    });
    expect(
      graph.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target)),
    ).toBe(true);
    expect(DEMO_REPOSITORY.latestJob?.nodesCreated).toBe(graph.nodes.length);
    expect(DEMO_REPOSITORY.latestJob?.edgesCreated).toBe(graph.edges.length);
  });

  it("filters search results and returns an empty list for missing symbols", () => {
    const search = (query: string) =>
      demoResponse("/api/repositories/demo/search", {
        method: "POST",
        body: JSON.stringify({ query }),
      }) as SearchPayload;
    expect(search("storefront").results.map((result) => result.name)).toContain(
      "Storefront",
    );
    expect(search("nonexistent-symbol").results).toEqual([]);
  });

  it("labels chat responses as sample data and links to valid graph nodes", () => {
    const chat = demoResponse("/api/repositories/demo/chat", {
      method: "POST",
    }) as ChatPayload;
    const graph = demoResponse("/api/repositories/demo/graph") as GraphPayload;
    expect(chat.answer).toContain("sample");
    expect(
      chat.canvasPath.every((id) => graph.nodes.some((node) => node.id === id)),
    ).toBe(true);
  });

  it("rejects writes, branch changes, and indexing of the sample", () => {
    for (const [path, method] of [
      ["", "DELETE"],
      ["/branch", "PATCH"],
      ["/index", "POST"],
    ]) {
      expect(() =>
        demoResponse(`/api/repositories/demo${path}`, { method }),
      ).toThrow("read-only");
    }
  });
});
