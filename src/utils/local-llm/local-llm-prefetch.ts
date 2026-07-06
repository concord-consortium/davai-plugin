import {
  getCollectionItemsForAttribute, getCollectionItemsForAttributePair, getGraphAdornments, getGraphByID
} from "../codap-api-utils";
import { capValues } from "./tools/get-case-values";

// Compact, names-first dataset summary: "Mammals — Cases: Height (numeric), Habitat (categorical), Mass".
// Replaces the raw trimmed-JSON context dump (smaller, and no IDs for the model to fixate on).
export const buildSchemaDigest = (dataContexts: Record<string, any>): string =>
  Object.values(dataContexts ?? {})
    .map((dc: any) => {
      const collections = (dc?.collections ?? [])
        .map((c: any) => {
          const attrs = (c?.attrs ?? [])
            .map((a: any) => (a?.type ? `${a.name} (${a.type})` : a?.name))
            .join(", ");
          return `${c.name}: ${attrs}`;
        })
        .join(" | ");
      return `${dc?.name} — ${collections}`;
    })
    .join("\n");

// Deterministic pre-seed for the selected graph: structure + visible adornments + capped
// case values. Fails soft (empty string) — a missing seed degrades to tool calls, never
// to a broken turn.
export const buildGraphSeed = async (
  graphId: string,
  dataContexts: Record<string, any>
): Promise<string> => {
  try {
    const graph = await getGraphByID(graphId);
    const x = graph?.xAttributeName ?? null;
    const y = graph?.yAttributeName ?? null;
    if (!x && !y) return "";
    const dc = Object.values(dataContexts ?? {}).find((d: any) => d?.name === graph?.dataContext);
    if (!dc) return "";

    const adornments = await getGraphAdornments(Number(graphId));
    const adornmentText = adornments.length
      ? adornments.map((a) => `${a.type}: ${a.value ?? `mean ${a.mean}, min ${a.min}, max ${a.max}`}`).join("; ")
      : "none";

    const items = x && y
      ? await getCollectionItemsForAttributePair(dc, x, y)
      : await getCollectionItemsForAttribute(dc, (x ?? y) as string);
    const { kept, sampled, total } = capValues(items);
    const rows = kept
      .map((it: any) => (x && y ? `${it.values[x]}, ${it.values[y]}` : String(it.values[(x ?? y) as string])))
      .join("; ");
    const sampleNote = sampled ? ` (evenly sampled ${kept.length} of ${total})` : "";

    return [
      `Selected graph "${graph?.title ?? graph?.name ?? graphId}" (data context: ${graph?.dataContext}).`,
      `x-axis: ${x ?? "(none)"}; y-axis: ${y ?? "(none)"}. Adornments: ${adornmentText}.`,
      `Values${x && y ? ` (${x}, ${y})` : ` (${x ?? y})`} — ${total} cases${sampleNote}: ${rows}`,
    ].join("\n");
  } catch {
    return "";
  }
};
