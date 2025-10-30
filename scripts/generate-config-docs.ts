import { Project, SyntaxKind } from "ts-morph";
import { getType, IAnyType, isStateTreeNode } from "mobx-state-tree";
import * as fs from "node:fs";
import * as path from "node:path";
import { AppConfigModel } from "../src/models/app-config-model";
import appConfigJson from "../src/app-config.json";

interface Entry {
  path: string;
  type?: string;
  default?: string;
  description?: string;
  allowed?: string;
}

const instance = AppConfigModel.create(appConfigJson);
const modelType = getType(instance);

// 1. Collect comments with ts-morph
const project = new Project({ tsConfigFilePath: path.resolve("tsconfig.json") });
const source = project.getSourceFileOrThrow("src/models/app-config-model.ts");

const commentMap = new Map<string, string>();

function extractComment(node: any): string | undefined {
  // Our property nodes are not currently supported by ts-morph as having
  // jsDocs, however we can still access the with the underlying compiler API
  const jsDocs = node.getNodeProperty("jsDoc");
  if (!jsDocs?.length) return;
  return jsDocs.map((d: any) => d.getComment()).filter(Boolean).join("\n").trim();
}

// Find the top-level types.model call for AppConfigModel
const modelCall = source.getDescendantsOfKind(SyntaxKind.CallExpression)
  .find(c => c.getExpression().getText().includes("types.model") && c.getArguments().length >= 2);

if (!modelCall) throw new Error("AppConfigModel types.model call not found");

const objLiteral = modelCall.getArguments()[1];
if (!objLiteral || !objLiteral.isKind(SyntaxKind.ObjectLiteralExpression)) {
  throw new Error("Model initializer is not an object literal");
}

function walkObjectLiteral(prefix: string, obj: any) {
  obj.getProperties().forEach((prop: any) => {
    const name = prop.getName?.();
    if (!name) return;
    const full = prefix ? `${prefix}.${name}` : name;
    const comment = extractComment(prop);
    if (comment) commentMap.set(full, comment);

    const init = prop.getInitializer?.();
    // Nested types.model: recurse to collect inner property comments
    if (init?.isKind(SyntaxKind.CallExpression) &&
        init.getExpression().getText().includes("types.model")) {
      const innerArgs = init.getArguments();
      const innerObj = innerArgs[innerArgs.length - 1];
      if (innerObj?.isKind(SyntaxKind.ObjectLiteralExpression)) {
        walkObjectLiteral(full, innerObj);
      }
    }
  });
}

walkObjectLiteral("", objLiteral);

// 2. Walk MST runtime type
const entries: Entry[] = [];

function unwrapType(t: IAnyType): { label: string; allowed?: string } {
  const name = (t as any).name || t.toString();
  // Optional
  if ((t as any).type) {
    // Older MST optional wrapper may have .type
    const inner = (t as any).type;
    const innerUnwrapped = unwrapType(inner);
    return { label: `${innerUnwrapped.label} (optional)`, allowed: innerUnwrapped.allowed };
  }
  if ((t as any).subtype) {
    // OptionalType new API
    const innerUnwrapped = unwrapType((t as any).subtype);
    return { label: `${innerUnwrapped.label} (optional)`, allowed: innerUnwrapped.allowed };
  }
  // Enumeration
  if ((t as any).options) {
    return { label: "enum", allowed: (t as any).options.join(", ") };
  }
  // Array
  if ((t as any).subType) {
    const inner = unwrapType((t as any).subType);
    if (name === "Array") return { label: `array<${inner.label}>`, allowed: inner.allowed };
  }
  // Model
  if ((t as any).properties) {
    return { label: "object" };
  }
  // Primitive
  if (name.match(/string/i)) return { label: "string" };
  if (name.match(/number/i)) return { label: "number" };
  if (name.match(/boolean/i)) return { label: "boolean" };
  return { label: name.replace(/Type$/, "") };
}

function collectFromInstance(node: any, prefix: string, type: any) {
  // For model types, iterate properties
  if (type.properties) {
    Object.keys(type.properties).forEach(key => {
      const propType = type.properties[key];
      const pathName = prefix ? `${prefix}.${key}` : key;
      if (propType.properties) {
        // nested object
        const childValue = node[key];
        collectFromInstance(childValue, pathName, propType);
      } else {
        const { label, allowed } = unwrapType(propType);
        const value = node[key];
        entries.push({
          path: pathName,
          type: label,
            // Represent defaults: if property exists on fresh instance
          default: value !== undefined && !isStateTreeNode(value) ? JSON.stringify(value) : "",
          description: commentMap.get(pathName),
          allowed
        });
      }
    });
  }
}

collectFromInstance(instance, "", modelType);

// 3. Render Markdown
function paddedString(str: string | undefined, length: number): string {
  if (!str) return " ".repeat(length);
  return str + " ".repeat(Math.max(0, length - str.length));
}
function columnInfo(label: string, propName: keyof Entry, maxWidth?: number): [number, string, string] {
  const maxValueLength = Math.max(...entries.map(e => (e[propName]?.length || 0)));
  const width = Math.min(maxWidth || Infinity, Math.max(maxValueLength, label.length));
  return [
    width,
    paddedString(label, width),
    "-".repeat(width),
  ];
}
const sortedEntries = entries.sort((a, b) => a.path.localeCompare(b.path));
const [keyWidth, keyHeader, keyDivider] = columnInfo("Key", "path");
const [typeWidth, typeHeader, typeDivider] = columnInfo("Type", "type");
const [defaultWidth, defaultHeader, defaultDivider] = columnInfo("Default", "default", 20);
const [allowedWidth, allowedHeader, allowedDivider] = columnInfo("Allowed / Enum", "allowed");
const lines: string[] = [];
lines.push("# Configuration Settings");
lines.push("Generated from source comments and MST runtime introspection. Do not edit manually.\n");
lines.push(`| ${keyHeader} | ${typeHeader} | ${defaultHeader} | ${allowedHeader} |`);
lines.push(`| ${keyDivider} | ${typeDivider} | ${defaultDivider} | ${allowedDivider} |`);
sortedEntries.forEach(e => {
  lines.push(`| ${paddedString(e.path, keyWidth)} | ${paddedString(e.type, typeWidth)} | ${paddedString(e.default, defaultWidth)} | ${paddedString(e.allowed, allowedWidth)} |`);
});
sortedEntries.forEach(e => {
  if (!e.description) return;
  lines.push(`\n## \`${e.path}\`\n`);
  lines.push(e.description);
});

const outPath = path.resolve("docs/configuration.md");
fs.writeFileSync(outPath, lines.join("\n"));
console.log("Wrote", outPath);
