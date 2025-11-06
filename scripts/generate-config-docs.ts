import { CallExpression, ObjectLiteralExpression, Project, PropertyAssignment, SyntaxKind, ts } from "ts-morph";
import { getType, IAnyType, isLiteralType, isStateTreeNode, isUnionType } from "mobx-state-tree";
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

// To figure out the names of the TS syntax this page is really helpful:
// https://ts-ast-viewer.com/

// 1. Collect comments with ts-morph
const project = new Project({ tsConfigFilePath: path.resolve("tsconfig.json") });
const source = project.getSourceFileOrThrow("src/models/app-config-model.ts");

const commentMap = new Map<string, string>();

function extractComment(node: PropertyAssignment): string | undefined {
  // PropertyAssignment nodes are not currently supported by ts-morph as having
  // jsDocs, however it still allows us to do this with the getNodeProperty
  // method. That basically calls the underlying compiler API directly and
  // wraps the result in a ts-morph Node.
  const jsDocs = (node as any).getNodeProperty("jsDoc");
  if (!jsDocs?.length) return;
  return jsDocs.map((d: any) => d.getComment()).filter(Boolean).join("\n").trim();
}

function getMSTPropertiesLiteral(callExpression: CallExpression<ts.CallExpression> ) {
  // If the callExpression passed in is a chained call like:
  // `types.model(...).actions(...).views(...)`
  // Then the initial callExpression is actually the `views(..)`
  // But it has children including the left side of the `.`
  // So we search all of its children for a callExpression with
  // `types.model`.
  let modelTypeCall: CallExpression<ts.CallExpression> | undefined;
  if (callExpression.getExpression().getText() === "types.model") {
    modelTypeCall = callExpression;
  } else {
    modelTypeCall = callExpression.getDescendantsOfKind(SyntaxKind.CallExpression).find(
      ce => ce.getExpression().getText() === "types.model"
    );
  }
  if (!modelTypeCall) return;


  // This will pickup the object defining the properties in either:
  // types.model("Name", { ... })
  // or
  // types.model({ ... })
  const args = modelTypeCall.getArguments();
  const objLiteral = args[args.length - 1];
  if (!objLiteral || !objLiteral.isKind(SyntaxKind.ObjectLiteralExpression)) {
    throw new Error(`Model initializer is not an object literal. callExpression: ${modelTypeCall.getText()} args: ${args.map((arg: any) => arg.getText()).join(", ")}`);
  }

  return objLiteral;
}

// Find the top-level types.model call for AppConfigModel
const modelCall = source.getDescendantsOfKind(SyntaxKind.CallExpression)
  .find(c => c.getExpression().getText() === "types.model"
    && c.getArguments().length >= 2
    && c.getArguments()[0].getText().includes("AppConfigModel"));

if (!modelCall) throw new Error("AppConfigModel types.model call not found");

const rootConfigObjLiteral = getMSTPropertiesLiteral(modelCall);
if (!rootConfigObjLiteral) throw new Error("AppConfigModel properties object literal not found");
function walkObjectLiteral(prefix: string, obj: ObjectLiteralExpression) {
  obj.getProperties().forEach(prop => {
    if (!prop.isKind(SyntaxKind.PropertyAssignment)) return;
    const name = prop.getName?.();
    if (!name) return;
    const full = prefix ? `${prefix}.${name}` : name;
    console.log("Processing property:", full);
    const comment = extractComment(prop);
    if (comment) commentMap.set(full, comment);

    const init = prop.getInitializer?.();
    // Handle nested types.model like:
    // `someProp: types.model({...})`
    if (init?.isKind(SyntaxKind.CallExpression)) {
      const innerObj = getMSTPropertiesLiteral(init);
      if (innerObj) {
        walkObjectLiteral(full, innerObj);
      } else {
        // Silently skip non nested MST model definitions like:
        // someProp: types.array(types.frozen()),
        // These props will are still handled by the extractComment above.
        // Their actual type information is figured out later from the MST runtime.
      }
    }
    // Handle nested types that are declared separately like:
    // `someProp: SomeType`
    else if (init?.isKind(SyntaxKind.Identifier)) {
      const symbol = init.getSymbol();
      if (!symbol) {
        console.log(`No symbol found for identifier when processing property "${full}", identifier: ${init.getText()}`);
        return;
      }
      // Get its first declaration.
      // Note: we currently don't handle nested types declared in other files.
      const decl = symbol.getDeclarations()[0];
      if (!decl.isKind(SyntaxKind.VariableDeclaration)) {
        console.log(`Unexpected declaration kind for identifier when processing property "${full}", declaration: ${decl.getText()}`);
        return;
      }
      const valueInit = decl.getInitializer();
      if (!valueInit) {
        console.log(`No initializer found for variable declaration when processing property "${full}", declaration: ${decl.getText()}`);
        return;
      }
      if (!valueInit.isKind(SyntaxKind.CallExpression)) {
        console.log(`Unexpected initializer kind for variable declaration when processing property "${full}", initializer: ${valueInit.getText()}`);
        return;
      }
      const innerObj = getMSTPropertiesLiteral(valueInit);
      if (innerObj) {
        walkObjectLiteral(full, innerObj);
      } else {
        console.log(`Unexpected identifier structure in property "${full}", identifier: ${valueInit.getText()}`);
      }
    }
  });
}

walkObjectLiteral("", rootConfigObjLiteral);

// 2. Walk MST runtime type
const entries: Entry[] = [];

function unwrapType(t: IAnyType): { label: string; allowed?: string } {
  const name = (t as any).name || t.toString();
  // Optional
  if ((t as any).subtype) {
    const innerUnwrapped = unwrapType((t as any).subtype);
    return { label: `${innerUnwrapped.label} (optional)`, allowed: innerUnwrapped.allowed };
  }
  // Enumeration
  if (isUnionType(t)) {
    const subTypes = (t as any).getSubTypes() as IAnyType[];
    if (subTypes.every((subType) => isLiteralType(subType) && typeof (subType as any).value === "string")) {
      // This is an enumeration of strings
      return {
        label: "enum",
        allowed: subTypes.map((st) => (st as any).value).join(", ")
      };
    }
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

  // By default just return the type name
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
// The max width numbers of 39, 8, and 43 were chosen so the table fits within 100 characters wide normally.
const [keyWidth, keyHeader, keyDivider] = columnInfo("Key", "path", 39);
const [typeWidth, typeHeader, typeDivider] = columnInfo("Type", "type", 8);
const [defaultWidth, defaultHeader, defaultDivider] = columnInfo("Default", "default", 43);
const lines: string[] = [];
lines.push("# Configuration Settings");
lines.push("Generated from source comments and MST runtime introspection. Do not edit manually.\n");
lines.push(`| ${keyHeader} | ${typeHeader} | ${defaultHeader} |`);
lines.push(`| ${keyDivider} | ${typeDivider} | ${defaultDivider} |`);
sortedEntries.forEach(e => {
  lines.push(`| ${paddedString(e.path, keyWidth)} | ${paddedString(e.type, typeWidth)} | ${paddedString(e.default, defaultWidth)} |`);
});
sortedEntries.forEach(e => {
  if (!e.description) return;
  lines.push(`\n## \`${e.path}\`\n`);
  if (e.allowed) {
    lines.push(`**Allowed values:** ${e.allowed}\n`);
  }
  lines.push(e.description);
});

const outPath = path.resolve("docs/configuration.md");
fs.writeFileSync(outPath, lines.join("\n"));
console.log("Wrote", outPath);
