/** Writes docs/architecture/*.mmd from the single diagram source. Run: pnpm diagrams */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAGRAMS, toMermaid } from "../packages/core/src/architecture/diagrams";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "architecture");
mkdirSync(out, { recursive: true });
for (const d of DIAGRAMS) {
  writeFileSync(join(out, d.file), toMermaid(d));
  console.log(`wrote docs/architecture/${d.file} (${d.nodes.length} nodes, ${d.edges.length} edges)`);
}
