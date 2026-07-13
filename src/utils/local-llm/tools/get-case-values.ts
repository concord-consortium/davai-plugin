import { getCollectionItemsForAttribute, getCollectionItemsForAttributePair } from "../../codap-api-utils";
import { ILocalTool } from "./registry";
import { resolveAttribute, resolveDataContext } from "./resolve";

// A bare `String(value)` would render the literal text "null"/"undefined" for a blank cell — a
// screen-reader user would hear those words as if they were real data values.
const displayValue = (v: unknown): string => (v === null || v === undefined || v === "" ? "(blank)" : String(v));

export const getCaseValuesTool: ILocalTool = {
  name: "get_case_values",
  description: "Get the case values for one attribute (or a pair) from a data context.",
  argsExample: '{"tool": "get_case_values", "dataContext": "Mammals", "attribute": "Height"} (optional: "attribute2")',
  validate(args, ctx) {
    const dc = resolveDataContext(String(args.dataContext ?? ""), ctx.dataContexts());
    if (!dc.ok) return { ok: false, error: dc.error };
    const attr = resolveAttribute(String(args.attribute ?? ""), dc.value);
    if (!attr.ok) return { ok: false, error: attr.error };
    const resolved: Record<string, unknown> = {
      dataContext: dc.value, attribute: attr.value.attr.name,
    };
    if (args.attribute2 !== undefined && args.attribute2 !== "") {
      const attr2 = resolveAttribute(String(args.attribute2), dc.value);
      if (!attr2.ok) return { ok: false, error: attr2.error };
      resolved.attribute2 = attr2.value.attr.name;
    }
    return { ok: true, resolved };
  },
  async execute(resolved, _ctx) {
    const dc = resolved.dataContext as any;
    const attribute = resolved.attribute as string;
    const attribute2 = resolved.attribute2 as string | undefined;
    const items = attribute2
      ? await getCollectionItemsForAttributePair(dc, attribute, attribute2)
      : await getCollectionItemsForAttribute(dc, attribute);
    // No sampling — every case value is included, per an explicit user directive: "don't sample
    // attribute values above 100. You need to process them all." The loop's capToolResult
    // (8,000-char tool-result cap) is the intentional safety net for outsized results, not this
    // tool.
    const rows = items.map((it: any) =>
      attribute2
        ? `${displayValue(it.values[attribute])}, ${displayValue(it.values[attribute2])}`
        : displayValue(it.values[attribute])
    ).join("; ");
    const header = attribute2 ? `${attribute}, ${attribute2}` : attribute;
    return `${header} — ${items.length} cases: ${rows}`;
  },
};
