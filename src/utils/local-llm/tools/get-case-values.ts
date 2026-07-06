import { getCollectionItemsForAttribute, getCollectionItemsForAttributePair } from "../../codap-api-utils";
import { ILocalTool } from "./registry";
import { resolveAttribute, resolveDataContext } from "./resolve";

export const CASE_VALUE_CAP = 100;

export const capValues = <T>(items: T[], cap = CASE_VALUE_CAP): { kept: T[]; sampled: boolean; total: number } => {
  if (items.length <= cap) return { kept: items, sampled: false, total: items.length };
  const step = items.length / cap;
  const kept: T[] = [];
  for (let i = 0; i < cap; i++) kept.push(items[Math.floor(i * step)]);
  return { kept, sampled: true, total: items.length };
};

export const getCaseValuesTool: ILocalTool = {
  name: "get_case_values",
  description: "Get the case values for one attribute (or a pair) from a data context. Values are sampled above 100 cases.",
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
    const { kept, sampled, total } = capValues(items);
    const rows = kept.map((it: any) =>
      attribute2 ? `${it.values[attribute]}, ${it.values[attribute2]}` : String(it.values[attribute])
    ).join("; ");
    const header = attribute2 ? `${attribute}, ${attribute2}` : attribute;
    const sampleNote = sampled ? ` (evenly sampled ${kept.length} of ${total})` : "";
    return `${header} — ${total} cases${sampleNote}: ${rows}`;
  },
};
