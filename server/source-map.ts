import ts from "typescript";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import type { GraphEdge, GraphNode } from "../shared/types.js";

type Binding = {
  local: string;
  module: string;
  imported: string;
  level?: number;
};
type Call = { name: string; line: number; endpoint?: boolean; refs?: string[] };
type SymbolInfo = {
  name: string;
  line: number;
  calls: Call[];
  route?: string;
  header?: string;
  shadows?: string[];
};
type Declaration = {
  owner: string;
  receiver: string;
  method: string;
  line: number;
  args: string[];
  targets?: string[];
};
type ModuleInfo = {
  file: string;
  symbols: SymbolInfo[];
  imports: Binding[];
  declarations: Declaration[];
  builders?: { receiver: string; scope: string; constructor: string }[];
  aliases?: { local: string; target: string; scope: string }[];
  invalid?: boolean;
};
export type SourceMapResult = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  coverage: string[];
  limitations: string[];
};
const sourceExtension = /\.(?:[cm]?[jt]sx?|py)$/i;
const endpoint =
  /(?:chat\/completions|generateContent|\/v1\/messages|\/v1\/responses)/i;
const id = (value: string) =>
  "src_" + createHash("sha256").update(value).digest("hex").slice(0, 16);

export function sourceCategory(file: string): string {
  if (/\.(?:md|txt|rst)$/i.test(file) || /(?:^|\/)docs?\//i.test(file))
    return "Documentation";
  if (/(?:^|\/)(?:auth|session|identity)(?:[./_-]|$)/i.test(file))
    return "Authentication";
  if (
    /(?:^|\/)(?:db|database|store|storage|cloud|migrations|supabase)(?:[./_-]|$)/i.test(
      file,
    )
  )
    return "Data / infrastructure";
  if (
    /(?:^|\/)(?:tests?|evals?|scripts?|fixtures|__tests__)(?:\/|$)|\.(?:test|spec)\./i.test(
      file,
    )
  )
    return "Tests / scripts";
  if (
    /\.(?:tsx|jsx|css|html)$/i.test(file) ||
    /(?:^|\/)(?:public|static|components|templates|frontend)\//i.test(file) ||
    /(?:^|\/)page\.[jt]s$/i.test(file)
  )
    return "UI";
  if (
    /(?:^|\/)(?:agents?|llm|tools?|workflow|orchestrat|runtime|graph)/i.test(
      file,
    )
  )
    return "Agent workflow";
  if (sourceExtension.test(file)) return "Application code";
  return "Supporting configuration";
}
const supporting = (file: string) =>
  [
    "UI",
    "Documentation",
    "Authentication",
    "Data / infrastructure",
    "Tests / scripts",
    "Supporting configuration",
  ].includes(sourceCategory(file));
const safeLabel = (value: string) =>
  value
    .replace(
      /(?:AIza[\w-]{25,}|sk-(?:ant-)?[\w-]{18,}|Bearer\s+\S+)/gi,
      "[REDACTED]",
    )
    .slice(0, 160);

/** Headers only, with every string/default literal removed. No prompt or source body enters the graph. */
function safeHeader(value = "") {
  return safeLabel(
    value
      .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '"[literal]"')
      .replace(
        /(?:api_?key|token|password|secret)\s*=\s*[^,)}]+/gi,
        "credential=[REDACTED]",
      ),
  ).slice(0, 240);
}

function tsModule(file: string, text: string): ModuleInfo {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const result: ModuleInfo = {
    file,
    symbols: [],
    imports: [],
    declarations: [],
    aliases: [],
    builders: [],
    invalid: !!(sf as any).parseDiagnostics?.length,
  };
  if (result.invalid) return result;
  const names = new Map<ts.Node, string>();
  const line = (node: ts.Node) =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const nameOf = (node: ts.Node | undefined): string => {
    if (!node) return "";
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node))
      return [nameOf(node.expression), node.name.text]
        .filter(Boolean)
        .join(".");
    if (ts.isCallExpression(node)) return nameOf(node.expression);
    if (ts.isStringLiteralLike(node)) return node.text;
    return "";
  };
  const literal = (node: ts.Node | undefined) =>
    node && ts.isStringLiteralLike(node) ? node.text : nameOf(node);
  const constants = new Map<string, string>();
  const staticText = (
    node: ts.Node | undefined,
    owner?: SymbolInfo,
  ): string => {
    if (!node) return "";
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isTemplateExpression(node))
      return (
        node.head.text + node.templateSpans.map((s) => s.literal.text).join("")
      );
    if (ts.isIdentifier(node))
      return (
        constants.get(`${owner?.name || ""}:${node.text}`) ||
        (!owner?.shadows?.includes(node.text)
          ? constants.get(`:${node.text}`)
          : "") ||
        ""
      );
    return "";
  };
  const routeCall = (node: ts.CallExpression) =>
    ts.isPropertyAccessExpression(node.expression) &&
    /^(?:get|post|put|patch|delete|route|use)$/i.test(
      node.expression.name.text,
    ) &&
    node.arguments[0] &&
    ts.isStringLiteralLike(node.arguments[0]) &&
    node.arguments[0].text.startsWith("/");
  const fnName = (node: ts.FunctionLikeDeclaration) => {
    if (node.name) return nameOf(node.name);
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent)) return nameOf(parent.name);
    if (ts.isPropertyAssignment(parent)) return nameOf(parent.name);
    if (ts.isCallExpression(parent) && routeCall(parent))
      return `${nameOf(parent.expression).split(".").pop()?.toUpperCase()} ${literal(parent.arguments[0])}`;
    if (ts.isExportAssignment(parent)) return "default";
    return "";
  };
  const visit = (node: ts.Node, owner?: SymbolInfo) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const value = staticText(node.initializer, owner);
      if (value) constants.set(`${owner?.name || ""}:${node.name.text}`, value);
      if (owner) owner.shadows!.push(node.name.text);
      if (ts.isCallExpression(node.initializer))
        result.aliases!.push({
          local: node.name.text,
          target: nameOf(node.initializer.expression).split(".")[0],
          scope: owner?.name || "",
        });
      if (
        ts.isNewExpression(node.initializer) ||
        ts.isCallExpression(node.initializer)
      )
        result.builders!.push({
          receiver: node.name.text,
          scope: owner?.name || "module",
          constructor: nameOf(node.initializer.expression),
        });
    }
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const module = node.moduleSpecifier.text,
        clause = node.importClause;
      if (clause?.name)
        result.imports.push({
          local: clause.name.text,
          module,
          imported: "default",
        });
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings))
        result.imports.push({
          local: clause.namedBindings.name.text,
          module,
          imported: "*",
        });
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
        for (const item of clause.namedBindings.elements)
          result.imports.push({
            local: item.name.text,
            module,
            imported: item.propertyName?.text || item.name.text,
          });
    }
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node)
    ) {
      const local = fnName(node);
      if (local) {
        const className =
          ts.isMethodDeclaration(node) && ts.isClassDeclaration(node.parent)
            ? node.parent.name?.text
            : undefined;
        const name = [owner?.name || className, local]
          .filter(Boolean)
          .join(".");
        const route =
          /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(local) &&
          /(?:^|\/)route\.[cm]?[jt]s$/.test(file)
            ? `${local} /${file.replace(/^(?:src\/)?app\//, "").replace(/\/route\.[^.]+$/, "")}`
            : /^(?:GET|POST|PUT|PATCH|DELETE|USE|ROUTE) /.test(local)
              ? local
              : undefined;
        owner = {
          name,
          line: line(node),
          route,
          calls: [],
          shadows: node.parameters.flatMap((p) =>
            ts.isIdentifier(p.name) ? [p.name.text] : [],
          ),
          header: text.split("\n")[line(node) - 1]?.trim(),
        };
        names.set(node, name);
        result.symbols.push(owner);
      }
    }
    if (ts.isCallExpression(node)) {
      const name = nameOf(node.expression);
      if (owner && name && owner.calls.length < 160)
        owner.calls.push({
          name,
          line: line(node),
          endpoint:
            /(?:^|\.)(?:fetch|post|request)$/.test(name) &&
            endpoint.test(staticText(node.arguments[0], owner)),
          refs: node.arguments.filter(ts.isIdentifier).map((n) => n.text),
        });
      if (
        /\.(?:addNode|addEdge|addConditionalEdges|setEntryPoint)$/.test(name)
      ) {
        const mapping = node.arguments[2];
        result.declarations.push({
          owner: owner?.name || "module",
          receiver: name.slice(0, name.lastIndexOf(".")),
          method: name.split(".").at(-1)!,
          line: line(node),
          args: node.arguments.slice(0, 2).map(literal),
          targets:
            mapping && ts.isObjectLiteralExpression(mapping)
              ? mapping.properties
                  .filter(ts.isPropertyAssignment)
                  .map((p) => literal(p.initializer))
              : undefined,
        });
      }
      if (routeCall(node)) {
        const handler = node.arguments.at(-1);
        if (handler && ts.isIdentifier(handler)) {
          const symbol = result.symbols.find((s) => s.name === handler.text);
          if (symbol)
            symbol.route = `${name.split(".").at(-1)?.toUpperCase()} ${literal(node.arguments[0])}`;
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, owner));
  };
  visit(sf);
  return result;
}

// The isolated interpreter only parses JSON-supplied source with stdlib ast.
// -I -S and cwd=/ prevent repo sitecustomize/import shadowing; no repo module is loaded.
const PYTHON_PARSER = String.raw`import ast,json,sys
def expr(n):
 if isinstance(n,ast.Name): return n.id
 if isinstance(n,ast.Attribute): return expr(n.value)+'.'+n.attr
 if isinstance(n,ast.Call): return expr(n.func)
 return ''
def atom(n, bindings=None):
 if isinstance(n,ast.Constant) and isinstance(n.value,str): return n.value
 return (bindings or {}).get(expr(n),expr(n))
out=[]
for file,text in json.load(sys.stdin):
 result={'file':file,'symbols':[],'imports':[],'declarations':[],'aliases':[],'builders':[]}
 try: tree=ast.parse(text,filename=file)
 except (SyntaxError,ValueError,RecursionError): result['invalid']=True;out.append(result);continue
 lines=text.splitlines()
 class Scan(ast.NodeVisitor):
  def __init__(self): self.owner=None;self.scope='';self.bindings={}
  def visit_Import(self,n):
   for a in n.names: result['imports'].append({'local':a.asname or a.name.split('.')[0],'module':a.name,'imported':'*','level':0})
  def visit_ImportFrom(self,n):
   for a in n.names: result['imports'].append({'local':a.asname or a.name,'module':n.module or '', 'imported':a.name,'level':n.level})
  def visit_ClassDef(self,n):
   prior=self.scope;self.scope=(prior+'.' if prior else '')+n.name
   for x in n.body:self.visit(x)
   self.scope=prior
  def visit_Assign(self,n):
   if self.owner:
    self.owner['shadows'] += [x.id for target in n.targets for x in ast.walk(target) if isinstance(x,ast.Name)]
   if isinstance(n.value,ast.Call):
    for target in n.targets:
     if isinstance(target,ast.Name):result['aliases'].append({'local':target.id,'target':expr(n.value.func).split('.')[0],'scope':self.owner['name'] if self.owner else ''})
     if isinstance(target,ast.Name):result['builders'].append({'receiver':target.id,'scope':self.owner['name'] if self.owner else 'module','constructor':expr(n.value.func)})
   self.generic_visit(n)
  def visit_FunctionDef(self,n):
   prior,scope=self.owner,self.scope
   name=(scope+'.' if scope else '')+n.name
   self.owner={'name':name,'line':n.lineno,'calls':[],'shadows':[a.arg for a in n.args.posonlyargs+n.args.args+n.args.kwonlyargs],'header':lines[n.lineno-1].strip()};result['symbols'].append(self.owner);self.scope=name
   for d in n.decorator_list:
    if isinstance(d,ast.Call) and isinstance(d.func,ast.Attribute) and d.func.attr in ('get','post','put','patch','delete','route','websocket') and d.args and isinstance(d.args[0],ast.Constant) and isinstance(d.args[0].value,str): self.owner['route']=d.func.attr.upper()+' '+d.args[0].value
   for x in n.body:self.visit(x)
   self.owner,self.scope=prior,scope
  visit_AsyncFunctionDef=visit_FunctionDef
  def visit_For(self,n):
   # Expand only a bounded literal tuple/list of graph registrations, never eval().
   if isinstance(n.target,(ast.Tuple,ast.List)) and isinstance(n.iter,(ast.Tuple,ast.List)) and len(n.iter.elts)<80 and all(isinstance(e,(ast.Tuple,ast.List)) for e in n.iter.elts):
    old=self.bindings.copy()
    for row in n.iter.elts:
     self.bindings.update({expr(k):atom(v) for k,v in zip(n.target.elts,row.elts)})
     for x in n.body:self.visit(x)
    self.bindings=old
   else:self.generic_visit(n)
  def visit_Call(self,n):
   name=expr(n.func)
   if self.owner and name and len(self.owner['calls'])<160:
    strings=[a.value for a in n.args if isinstance(a,ast.Constant) and isinstance(a.value,str)]
    self.owner['calls'].append({'name':name,'line':n.lineno,'endpoint':name.rsplit('.',1)[-1] in ('fetch','post','request') and any(any(x in v for x in ('chat/completions','generateContent','/v1/messages','/v1/responses')) for v in strings),'refs':[expr(a) for a in n.args if isinstance(a,(ast.Name,ast.Attribute))]+[expr(k.value) for k in n.keywords if k.arg in ('target','fn','func') and isinstance(k.value,(ast.Name,ast.Attribute))]})
   method=name.rsplit('.',1)[-1]
   if method in ('add_node','add_edge','add_conditional_edges','set_entry_point'):
    targets=[]
    if len(n.args)>2 and isinstance(n.args[2],ast.Dict):targets=[atom(x,self.bindings) for x in n.args[2].values]
    for k in n.keywords:
     if k.arg=='destinations' and isinstance(k.value,(ast.Tuple,ast.List)):targets += [atom(x,self.bindings) for x in k.value.elts]
    result['declarations'].append({'owner':self.owner['name'] if self.owner else 'module','receiver':name.rsplit('.',1)[0],'method':method,'line':n.lineno,'args':[atom(x,self.bindings) for x in n.args[:2]],'targets':targets})
   self.generic_visit(n)
 Scan().visit(tree);out.append(result)
json.dump(out,sys.stdout,separators=(',',':'))
`;

async function pythonModules(
  sources: [string, string][],
): Promise<ModuleInfo[]> {
  if (!sources.length) return [];
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/python3", ["-I", "-S", "-c", PYTHON_PARSER], {
      cwd: "/",
      env: {},
      stdio: ["pipe", "pipe", "ignore"],
    });
    let result = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
    child.stdout.on("data", (data) => {
      result += data;
      if (result.length > 8_000_000) child.kill("SIGKILL");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw new Error("Python parsing unavailable");
        resolve(JSON.parse(result));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(sources));
  });
}

function resolveModule(
  file: string,
  binding: Binding,
  files: Set<string>,
): string | undefined {
  let base: string;
  if (file.endsWith(".py")) {
    const level = binding.level || 0;
    base = level
      ? path.posix.join(
          path.posix.dirname(file),
          ...Array(Math.max(0, level - 1)).fill(".."),
          binding.module.replaceAll(".", "/"),
        )
      : binding.module.replaceAll(".", "/");
    const candidates = [base + ".py", path.posix.join(base, "__init__.py")];
    return candidates.find((p) => files.has(p));
  }
  if (binding.module.startsWith("."))
    base = path.posix.join(path.posix.dirname(file), binding.module);
  else if (binding.module.startsWith("@/")) base = binding.module.slice(2);
  else return;
  const bases = [
    base,
    base.replace(/\.[cm]?js$/, ""),
    ...(binding.module.startsWith("@/") ? ["src/" + base] : []),
  ];
  return bases
    .flatMap((b) => [
      b,
      ...[
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        ".mts",
        "/index.ts",
        "/index.js",
      ].map((e) => b + e),
    ])
    .find((p) => files.has(p));
}

function callRole(call: Call): GraphNode["role"] | undefined {
  if (
    call.endpoint ||
    /(?:generateContent|generateText|generateObject|streamText|streamObject|chat\.completions\.create|messages\.(?:create|stream)|responses\.create|llm\.(?:invoke|ainvoke|structured|text)|(?:claude|gemini|openai|anthropic|runtime)\.(?:structured|complete|chat|text|generate))$/i.test(
      call.name,
    )
  )
    return "agent";
  if (
    /(?:^|\.)(?:safeParse|model_validate|validate_output|validate_decision|validate|check_output|guard|guardrail)$/.test(
      call.name,
    )
  )
    return "validator";
  if (
    /(?:^|\.)(?:fetch|crawl|web_search|source_lookup|calculate|retrieve|retriever|extract_pdf|run_tool|execute_tool)$/.test(
      call.name,
    )
  )
    return "tool";
  if (/(?:^|\.)(?:invoke|ainvoke|eval|exec)$/.test(call.name)) return "opaque";
  return;
}

/** Conservative, deterministic code map. It is not an executable manifest or an invocation trace. */
export async function mapGenericSources(
  files: string[],
  read: (file: string) => Promise<string>,
): Promise<SourceMapResult> {
  const modules: ModuleInfo[] = [],
    python: [string, string][] = [],
    limitations: string[] = [];
  let bytes = 0,
    skipped = 0;
  const candidates = files
    .filter(
      (f) =>
        sourceExtension.test(f) &&
        !["Documentation", "Tests / scripts", "UI"].includes(sourceCategory(f)),
    )
    .sort();
  for (const file of candidates) {
    if (modules.length + python.length >= 220 || bytes >= 12_000_000) {
      skipped++;
      continue;
    }
    try {
      const text = await read(file);
      bytes += Buffer.byteLength(text);
      if (file.endsWith(".py")) python.push([file, text]);
      else modules.push(tsModule(file, text));
    } catch {
      skipped++;
    }
  }
  try {
    modules.push(...(await pythonModules(python)));
  } catch {
    skipped += python.length;
    limitations.push(
      "Python AST parsing was unavailable; Python files remain source resources, not invented workflow nodes.",
    );
  }
  modules.sort((a, b) => a.file.localeCompare(b.file));
  const fileSet = new Set(files),
    byModule = new Map(modules.map((m) => [m.file, m]));
  const symbols = new Map<string, { module: ModuleInfo; symbol: SymbolInfo }>();
  for (const module of modules)
    for (const symbol of module.symbols)
      symbols.set(`${module.file}#${symbol.name}`, { module, symbol });
  const resolve = (
    module: ModuleInfo,
    owner: SymbolInfo,
    name: string,
  ): string | undefined => {
    const pieces = owner.name.split(".");
    while (pieces.length) {
      const key = `${module.file}#${[...pieces, name.replace(/^(?:self|this)\./, "")].join(".")}`;
      if (symbols.has(key)) return key;
      pieces.pop();
    }
    if (!owner.shadows?.includes(name) && symbols.has(`${module.file}#${name}`))
      return `${module.file}#${name}`;
    const [local, ...rest] = name.split(".");
    if (/^(?:invoke|ainvoke|stream|astream|run)$/.test(rest.join("."))) {
      const alias =
        module.aliases?.find(
          (a) => a.local === local && a.scope === owner.name,
        ) ||
        (!owner.shadows?.includes(local)
          ? module.aliases?.find((a) => a.local === local && !a.scope)
          : undefined);
      if (alias && symbols.has(`${module.file}#${alias.target}`))
        return `${module.file}#${alias.target}`;
    }
    if (owner.shadows?.includes(local)) return;
    const binding = module.imports.find((b) => b.local === local);
    if (!binding) return;
    let target = resolveModule(module.file, binding, fileSet);
    let imported =
      binding.imported === "*"
        ? rest.join(".")
        : [binding.imported, ...rest].join(".");
    // Python `from .agents import plan; plan.run(...)` names a submodule.
    if (module.file.endsWith(".py") && binding.imported !== "*") {
      const nested = resolveModule(
        module.file,
        {
          ...binding,
          module: [binding.module, binding.imported].filter(Boolean).join("."),
          imported: "*",
        },
        fileSet,
      );
      if (nested && rest.length) {
        target = nested;
        imported = rest.join(".");
      }
    }
    const key = target && `${target}#${imported}`;
    return key && symbols.has(key) ? key : undefined;
  };
  const relationships: {
    source: string;
    target: string;
    label: string;
    declared?: boolean;
  }[] = [];
  const ranks = new Map<string, number>(),
    roles = new Map<string, GraphNode["role"]>(),
    labels = new Map<string, string>();
  const external = new Map<
    string,
    { owner: string; call: Call; role: GraphNode["role"] }
  >();
  const select = (key: string, rank: number, role?: GraphNode["role"]) => {
    if (role && (!roles.has(key) || rank > (ranks.get(key) || 0)))
      roles.set(key, role);
    ranks.set(key, Math.max(ranks.get(key) || 0, rank));
  };
  for (const [key, { module, symbol }] of symbols) {
    if (supporting(module.file)) continue;
    for (const call of symbol.calls) {
      const target = resolve(module, symbol, call.name);
      if (target)
        relationships.push({
          source: key,
          target,
          label: `calls ${safeLabel(call.name)}`,
        });
      const role = callRole(call);
      if (role === "agent") select(key, 70, "agent");
      if (role && !target) {
        const token = `${key}@${call.name}`;
        external.set(token, { owner: key, call, role });
      }
      // Callback dispatch is a reference, not proof that the callback ran.
      if (
        /(?:run_in_threadpool|to_thread|Thread|submit|add_task)$/.test(
          call.name,
        )
      )
        for (const ref of call.refs || []) {
          const callback = resolve(module, symbol, ref);
          if (callback)
            relationships.push({
              source: key,
              target: callback,
              label: `dispatches ${safeLabel(ref)} (inferred)`,
            });
        }
    }
  }
  // Source-declared LangGraph topology takes priority over implementation helpers.
  for (const module of modules) {
    const groups = new Map<string, Declaration[]>();
    for (const d of module.declarations) {
      const builder = module.builders?.find(
        (b) => b.receiver === d.receiver && b.scope === d.owner,
      );
      const binding =
        builder &&
        module.imports.find(
          (b) => b.local === builder.constructor.split(".")[0],
        );
      if (
        !builder ||
        !binding ||
        !/langgraph/.test(binding.module) ||
        !/(?:StateGraph|MessageGraph|Graph)$/.test(
          binding.imported === "*" ? builder.constructor : binding.imported,
        )
      )
        continue;
      const group = `${d.owner}:${d.receiver}`;
      groups.set(group, [...(groups.get(group) || []), d]);
    }
    for (const declarations of groups.values()) {
      const registered = new Map<string, string>();
      for (const d of declarations.filter((d) => /add_?node/i.test(d.method))) {
        const owner = module.symbols.find((s) => s.name === d.owner) || {
          name: "",
          line: 1,
          calls: [],
        };
        const target = resolve(module, owner, d.args[1] || d.args[0]);
        if (!target || !/^[\w -]{1,80}$/.test(d.args[0])) continue;
        registered.set(d.args[0], target);
        select(
          target,
          100,
          /valid|check|guard/i.test(d.args[0])
            ? "validator"
            : /tool|retrieve/i.test(d.args[0])
              ? "tool"
              : /finish|deliver|output/i.test(d.args[0])
                ? "output"
                : "agent",
        );
        labels.set(target, d.args[0].replaceAll("_", " "));
      }
      for (const d of declarations) {
        const origin = registered.get(d.args[0]);
        const targets =
          /conditional/i.test(d.method) || /add_?node/i.test(d.method)
            ? d.targets || []
            : [d.args[1]];
        for (const name of targets) {
          const target = registered.get(name);
          if (origin && target)
            relationships.push({
              source: origin,
              target,
              label:
                /conditional/i.test(d.method) || /add_?node/i.test(d.method)
                  ? "declared possible route"
                  : "declared graph edge",
              declared: true,
            });
        }
        if (/START|__start__/.test(d.args[0] || ""))
          for (const name of targets) {
            const target = registered.get(name);
            if (target) {
              select(target, 110, "orchestrator");
              const owner = `${module.file}#${d.owner}`;
              if (symbols.has(owner)) {
                select(owner, 95, "orchestrator");
                relationships.push({
                  source: owner,
                  target,
                  label: "declared graph entry",
                  declared: true,
                });
              }
            }
          }
      }
    }
  }
  // Keep workflow-facing API entries and callers, not every CRUD/health route.
  for (let pass = 0; pass < 7; pass++)
    for (const edge of relationships)
      if (
        ranks.has(edge.target) &&
        !supporting(symbols.get(edge.source)!.module.file)
      )
        select(edge.source, 45, "orchestrator");
  for (const [key, { module, symbol }] of symbols) {
    if (supporting(module.file)) continue;
    if (
      symbol.route &&
      (ranks.has(key) ||
        /^(?:POST|WEBSOCKET) .*\/(?:generate|chat|grade|agent|build|read|turn|message|ask|align|live)$/.test(
          symbol.route,
        ))
    ) {
      select(key, 90, "orchestrator");
      labels.set(key, symbol.route);
    }
    if (
      /^(?:main|run|run_turn|run_job|orchestrate|build_graph)$/.test(
        symbol.name,
      ) &&
      sourceCategory(module.file) === "Agent workflow"
    )
      select(key, 55, "orchestrator");
  }
  // One direct layer of real model/tool/check functions supports the primary pipeline.
  const primary = new Set(ranks.keys());
  for (const edge of relationships)
    if (primary.has(edge.source)) {
      const item = symbols.get(edge.target)!;
      if (
        !supporting(item.module.file) &&
        /(?:^|\.)(?:run|build|structured|text|validate\w*|check\w*|guard\w*|retrieve\w*|web_search|source_lookup|calculate|tools_node)$/.test(
          item.symbol.name,
        )
      )
        select(
          edge.target,
          25,
          /valid|check|guard/i.test(item.symbol.name) ? "validator" : "tool",
        );
    }
  const chosen = new Set(
    [...ranks]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 90)
      .map(([key]) => key),
  );
  const nodes: GraphNode[] = [],
    edges: GraphEdge[] = [],
    edgeKeys = new Set<string>();
  const addEdge = (
    source: string,
    target: string,
    label: string,
    kind: GraphEdge["kind"] = "data",
    declared = false,
  ) => {
    const key = `${source}:${target}:${label}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      id: id(key),
      source,
      target,
      label,
      kind,
      provenance: declared ? "declared" : "inferred",
    });
  };
  for (const key of [...chosen].sort(
    (a, b) => ranks.get(b)! - ranks.get(a)! || a.localeCompare(b),
  )) {
    const { module, symbol } = symbols.get(key)!;
    nodes.push({
      id: id(key),
      label: safeLabel(
        labels.get(key) ||
          `${path.posix.basename(module.file).replace(/\.[^.]+$/, "")} · ${symbol.name.replaceAll("_", " ")}`,
      ),
      role: roles.get(key) || "orchestrator",
      description: `Static ${symbol.route ? "route" : "function"} at ${module.file}:${symbol.line}. Calls and possible routes are inferred from syntax; execution order, reachability and live behavior are not verified.`,
      source: { path: module.file, line: symbol.line, symbol: symbol.name },
      code: safeHeader(symbol.header),
      modelFixed: true,
    });
    addEdge(
      id(key),
      `file:${module.file}`,
      "implemented_by",
      "dependency",
      true,
    );
  }
  for (const edge of relationships) {
    if (!chosen.has(edge.source)) continue;
    if (chosen.has(edge.target))
      addEdge(
        id(edge.source),
        id(edge.target),
        edge.label,
        "data",
        edge.declared,
      );
    else {
      const item = symbols.get(edge.target)!;
      addEdge(
        id(edge.source),
        `file:${item.module.file}`,
        `depends_on ${safeLabel(item.symbol.name)} · collapsed`,
        "dependency",
      );
    }
  }
  let externalCount = 0;
  for (const [key, item] of external) {
    if (
      !chosen.has(item.owner) ||
      externalCount >= 35 ||
      item.role === "validator"
    )
      continue;
    externalCount++;
    const source = symbols.get(item.owner)!;
    nodes.push({
      id: id(key),
      label: safeLabel(
        `${item.role === "agent" ? "Model call" : item.role === "opaque" ? "Unresolved dispatch" : "Tool call"} · ${item.call.name}`,
      ),
      role: item.role,
      modelFixed: true,
      description:
        "Call site detected statically. Provider configuration, conditions, retries and output were not executed or verified.",
      source: {
        path: source.module.file,
        line: item.call.line,
        symbol: item.call.name,
      },
    });
    addEdge(id(item.owner), id(key), "possible call · inferred");
    addEdge(
      id(key),
      `file:${source.module.file}`,
      "implemented_by",
      "dependency",
      true,
    );
  }
  const invalid = modules.filter((m) => m.invalid).length;
  if (invalid || skipped)
    limitations.push(
      `${invalid} source files had parse errors; ${skipped} files were skipped/unreadable or exceeded parsing limits (220 files, 12 MB total). Those paths remain source resources.`,
    );
  if (ranks.size > chosen.size || external.size > externalCount)
    limitations.push(
      "The main map prioritizes declared graph steps and workflow-facing routes. Additional helpers, infrastructure and unresolved calls remain collapsed under source files; the map is not exhaustive.",
    );
  limitations.push(
    "Generic source maps never execute imported code. Syntax cannot establish runtime conditions, dispatch targets, concurrency, authorization or model compatibility. Python parsing requires /usr/bin/python3 and uses isolated stdlib ast parsing only.",
  );
  return {
    nodes,
    edges,
    coverage: [
      `${modules.length} TypeScript/JavaScript/Python source files parsed; ${symbols.size} function declarations found`,
      `${chosen.size} source-linked workflow candidates and ${externalCount} call-site candidates`,
      `${edges.filter((e) => e.kind === "data").length} declared/inferred candidate relationships`,
      `${Math.max(0, symbols.size - chosen.size)} additional function declarations retained in source-file inventory, not individually expanded`,
      `${external.size - externalCount} additional unresolved/external call sites are not expanded; no runtime reachability claimed`,
      "Deterministic source evidence for semantic interpretation; supporting files remain in Hidden nodes",
    ],
    limitations,
  };
}
