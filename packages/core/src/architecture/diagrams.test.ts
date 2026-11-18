import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAGRAMS, toMermaid } from "./diagrams";

const docs = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "docs", "architecture");

describe("architecture diagrams", () => {
  it("has the five workflow diagrams and the security path", () => {
    expect(DIAGRAMS.map((d) => d.id)).toEqual(["system", "account-connections", "publishing-learning", "advertising", "messaging-leads", "security"]);
  });

  for (const d of DIAGRAMS) {
    describe(d.id, () => {
      const ids = new Set(d.nodes.map((n) => n.id));
      it("has unique node ids and grid cells", () => {
        expect(ids.size).toBe(d.nodes.length);
        expect(new Set(d.nodes.map((n) => `${n.col}:${n.row}`)).size).toBe(d.nodes.length);
      });
      it("edges and dependencies only reference existing nodes", () => {
        for (const e of d.edges) expect(ids.has(e.from) && ids.has(e.to), `${e.from} → ${e.to}`).toBe(true);
        for (const n of d.nodes) for (const dep of n.deps) expect(ids.has(dep), `${n.id} depends on ${dep}`).toBe(true);
      });
      it("every node is reachable and documented in both languages", () => {
        const touched = new Set(d.edges.flatMap((e) => [e.from, e.to]));
        for (const n of d.nodes) {
          expect(touched.has(n.id), `${n.id} is not connected`).toBe(true);
          for (const t of [n.label, n.purpose, n.troubleshoot]) expect(t.en.length > 0 && t.it.length > 0).toBe(true);
          expect(n.service.length && n.technology.length && n.link.length).toBeTruthy();
        }
      });
      it("nodes without code carry no live probe (they can never look healthy)", () => {
        for (const n of d.nodes) if (n.state === "planned" || n.state === "candidate") expect(n.probe, n.id).toBeUndefined();
      });
      it("has at least one failure branch", () => {
        expect(d.edges.some((e) => e.kind === "failure" || e.kind === "optional")).toBe(true);
      });
      it("the Mermaid file in docs/architecture is in sync with the source (run `pnpm diagrams`)", () => {
        expect(readFileSync(join(docs, d.file), "utf8")).toBe(toMermaid(d));
      });
    });
  }
});
