import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// The server intentionally rejects mutation requests without JSON content type.
// api() adds that header only when callers provide a body, including empty {}.
test("browser API mutations always provide the JSON body required by the server", () => {
  const source = ts.createSourceFile("App.tsx", readFileSync(new URL("../web/App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const failures: number[] = [];
  let mutations = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "api") {
      const method = node.arguments[1];
      if (method && ts.isStringLiteral(method) && ["POST", "PUT", "PATCH", "DELETE"].includes(method.text)) {
        mutations++;
        if (!node.arguments[2] || node.arguments[2].kind === ts.SyntaxKind.UndefinedKeyword || node.arguments[2].getText(source) === "undefined") failures.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert(mutations > 10, "The complete browser source must be inspected");
  assert.deepEqual(failures, [], "Mutation callers must pass an object ({} when empty)");
});
