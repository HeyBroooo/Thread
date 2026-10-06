import { Node, Project, SyntaxKind, ts, type SourceFile } from 'ts-morph';
import { normalizePath, sha256, lineCount } from '@cbi/shared';
import type {
  HttpCallTarget,
  NavigationCall,
  ParsedCall,
  ParsedExport,
  ParsedFile,
  ParsedImport,
  ParsedJsx,
  ParsedSymbol,
  RawSymbolKind,
  ServerRouteCall,
} from './types.js';

const JSX_KINDS = [SyntaxKind.JsxElement, SyntaxKind.JsxSelfClosingElement, SyntaxKind.JsxFragment];
const HTTP_CLIENT_RE = /(api|http|client|axios|request|fetcher|graphql)/i;
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

let sharedProject: Project | null = null;

function getProject(): Project {
  if (!sharedProject) {
    sharedProject = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: false,
        noEmit: true,
      },
    });
  }
  return sharedProject;
}

function jsxCount(node: Node): number {
  let count = 0;
  for (const kind of JSX_KINDS) count += node.getDescendantsOfKind(kind).length;
  return count;
}

function hookCallsOf(node: Node): string[] {
  const hooks = new Set<string>();
  for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeNameOf(call);
    if (name && /^use[A-Z0-9]/.test(name)) hooks.add(name);
  }
  return [...hooks].sort();
}

function calleeNameOf(call: Node): string | null {
  if (!Node.isCallExpression(call)) return null;
  const expr = call.getExpression();
  if (Node.isIdentifier(expr)) return expr.getText();
  if (Node.isPropertyAccessExpression(expr)) return expr.getName();
  if (Node.isElementAccessExpression(expr)) return expr.getArgumentExpression()?.getText() ?? null;
  return null;
}

function calleeObjectOf(call: Node): string | null {
  if (!Node.isCallExpression(call)) return null;
  const expr = call.getExpression();
  if (Node.isPropertyAccessExpression(expr)) return expr.getExpression().getText();
  return null;
}

function classifySymbol(name: string, kind: RawSymbolKind, hasJsx: boolean, initializerKind: string | null, hooks: string[]): RawSymbolKind {
  if (kind === 'variable' || kind === 'constant') {
    if (initializerKind === 'createContext') return 'context';
    if (initializerKind === 'zustand-create' || initializerKind === 'redux-store') return 'store';
    return kind;
  }
  if (kind !== 'function') return kind;
  if (/^use[A-Z0-9]/.test(name)) return 'hook';
  if (hasJsx && /^[A-Z]/.test(name)) return 'component';
  // A capitalised function that returns JSX-like hooks is likely a component
  if (hasJsx) return 'component';
  if (hooks.length > 0 && /^[A-Z]/.test(name)) return 'component';
  return 'function';
}

function enclosingSymbolName(node: Node): string {
  const ancestor = node.getFirstAncestor((a) => {
    if (Node.isFunctionDeclaration(a)) return true;
    if (Node.isMethodDeclaration(a)) return true;
    if (Node.isArrowFunction(a) || Node.isFunctionExpression(a)) {
      const parent = a.getParent();
      return Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent) || Node.isPropertyDeclaration(parent);
    }
    return false;
  });
  if (!ancestor) return '<module>';
  if (Node.isFunctionDeclaration(ancestor)) return ancestor.getName() ?? '<anonymous>';
  if (Node.isMethodDeclaration(ancestor)) return ancestor.getName();
  const parent = ancestor.getParent();
  if (Node.isVariableDeclaration(parent)) return parent.getName();
  if (Node.isPropertyAssignment(parent) || Node.isPropertyDeclaration(parent)) return parent.getName();
  return '<anonymous>';
}

function detectInitializerKind(init: Node | undefined): string | null {
  if (!init) return null;
  if (Node.isCallExpression(init)) {
    const name = calleeNameOf(init);
    const obj = calleeObjectOf(init);
    if (name === 'createContext') return 'createContext';
    if (name === 'create' && obj && /zustand/i.test(obj)) return 'zustand-create';
    if (name === 'configureStore') return 'redux-store';
    return name;
  }
  if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) return 'function-expression';
  return null;
}

function httpTargetOf(call: Node, caller: string): HttpCallTarget | null {
  if (!Node.isCallExpression(call)) return null;
  const name = calleeNameOf(call);
  const obj = calleeObjectOf(call);
  if (!name) return null;

  const args = call.getArguments();
  const first = args[0];

  const extractUrl = (arg: Node | undefined): string | null => {
    if (!arg) return null;
    if (Node.isStringLiteral(arg)) return arg.getLiteralValue();
    if (Node.isNoSubstitutionTemplateLiteral(arg)) return arg.getLiteralText();
    if (Node.isTemplateExpression(arg)) return arg.getText().replace(/^`|`$/g, '');
    if (Node.isBinaryExpression(arg)) return arg.getText();
    return null;
  };

  let client: HttpCallTarget['client'] = 'unknown';
  let method: string | null = null;
  let url: string | null = null;

  if (name === 'fetch') {
    client = 'fetch';
    url = extractUrl(first);
    method = 'GET';
    const opts = args[1];
    if (opts && Node.isObjectLiteralExpression(opts)) {
      const m = opts.getProperty('method');
      if (m && Node.isPropertyAssignment(m)) {
        const init = m.getInitializer();
        if (init && Node.isStringLiteral(init)) method = init.getLiteralValue().toUpperCase();
      }
    }
  } else if (obj && /^axios$/i.test(obj) && HTTP_METHODS.has(name.toLowerCase())) {
    client = 'axios';
    method = name.toUpperCase();
    url = extractUrl(first);
  } else if (obj && /^axios$/i.test(obj) && name === 'request') {
    client = 'axios';
    url = extractUrl(first);
    method = 'GET';
  } else if (HTTP_CLIENT_RE.test(obj ?? '') || HTTP_CLIENT_RE.test(name)) {
    if (HTTP_METHODS.has(name.toLowerCase())) {
      client = 'custom';
      method = name.toUpperCase();
      url = extractUrl(first);
    } else if (name === 'request' || name === 'call' || name === 'send') {
      client = 'custom';
      url = extractUrl(first);
    }
  }

  if (!url) return null;
  return {
    caller,
    client,
    method,
    url,
    line: call.getStartLineNumber(),
    column: call.getStart() - call.getStartLinePos() + 1,
  };
}

export function parseFileContent(filePath: string, content: string): ParsedFile {
  const project = getProject();
  const safePath = '/__cbi__/' + normalizePath(filePath);
  const sourceFile: SourceFile = project.createSourceFile(safePath, content, { overwrite: true });

  // Only syntactic diagnostics matter here: we parse files in isolation, so
  // semantic "cannot find module/name" errors are expected and not real parse
  // failures. Genuine syntax errors are what we want to surface.
  const parseErrors: string[] = [];
  try {
    const diagnostics = project.getProgram().getSyntacticDiagnostics(sourceFile);
    for (const d of diagnostics.slice(0, 20)) {
      if (d.getCategory() === ts.DiagnosticCategory.Error) {
        const msg = d.getMessageText();
        parseErrors.push(typeof msg === 'string' ? msg : msg.getMessageText());
      }
    }
  } catch {
    /* diagnostics are best-effort */
  }

  const symbols: ParsedSymbol[] = [];

  const pushSymbol = (
    name: string,
    kind: RawSymbolKind,
    node: Node,
    opts: { exported: boolean; isAsync: boolean; initializerKind?: string | null },
  ) => {
    const jsx = jsxCount(node);
    const hooks = hookCallsOf(node);
    const finalKind = classifySymbol(name, kind, jsx > 0, opts.initializerKind ?? null, hooks);
    symbols.push({
      kind: finalKind,
      name,
      qualifiedName: name,
      startLine: node.getStartLineNumber(),
      endLine: node.getEndLineNumber(),
      exported: opts.exported,
      isAsync: opts.isAsync,
      hasJsx: jsx > 0,
      hookCalls: hooks,
      metadata: {
        jsxElements: jsx,
        declarationKind: kind,
        ...(opts.initializerKind ? { initializerKind: opts.initializerKind } : {}),
      },
    });
  };

  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName() ?? '<anonymous>';
    pushSymbol(name, 'function', fn, { exported: fn.isExported(), isAsync: fn.isAsync() });
  }

  for (const cls of sourceFile.getClasses()) {
    const name = cls.getName() ?? '<anonymous>';
    pushSymbol(name, 'class', cls, { exported: cls.isExported(), isAsync: false });
  }

  for (const iface of sourceFile.getInterfaces()) {
    pushSymbol(iface.getName(), 'interface', iface, { exported: iface.isExported(), isAsync: false });
  }

  for (const alias of sourceFile.getTypeAliases()) {
    pushSymbol(alias.getName(), 'type', alias, { exported: alias.isExported(), isAsync: false });
  }

  for (const en of sourceFile.getEnums()) {
    pushSymbol(en.getName(), 'enum', en, { exported: en.isExported(), isAsync: false });
  }

  for (const decl of sourceFile.getVariableDeclarations()) {
    const stmt = decl.getVariableStatement();
    const declKind = stmt?.getDeclarationKind() ?? 'const';
    const init = decl.getInitializer();
    const initializerKind = detectInitializerKind(init);
    const isAsync =
      init !== undefined && Node.isArrowFunction(init) ? init.isAsync() : false;
    const baseKind: RawSymbolKind = declKind === 'const' ? 'constant' : 'variable';
    pushSymbol(decl.getName(), baseKind, decl, {
      exported: stmt?.isExported() ?? false,
      isAsync,
      initializerKind,
    });
  }

  // ---------- imports ----------
  const imports: ParsedImport[] = [];
  for (const imp of sourceFile.getImportDeclarations()) {
    const named = imp.getNamedImports().map((n) => ({ name: n.getName(), alias: n.getAliasNode()?.getText() ?? null }));
    imports.push({
      moduleSpecifier: imp.getModuleSpecifierValue(),
      line: imp.getStartLineNumber(),
      defaultImport: imp.getDefaultImport()?.getText() ?? null,
      namespaceImport: imp.getNamespaceImport()?.getText() ?? null,
      namedImports: named,
      typeOnly: imp.isTypeOnly(),
      resolvedFilePath: null,
      resolution: 'unresolved',
    });
  }
  // dynamic imports / re-exports via `import()` -> surfaced as calls only

  // ---------- exports ----------
  const exports: ParsedExport[] = [];
  for (const exp of sourceFile.getExportDeclarations()) {
    const moduleSpec = exp.getModuleSpecifierValue();
    for (const named of exp.getNamedExports()) {
      exports.push({
        name: named.getName(),
        kind: moduleSpec ? `reexport:${moduleSpec}` : 'named',
        line: exp.getStartLineNumber(),
        isDefault: false,
      });
    }
  }
  for (const sym of symbols) {
    if (!sym.exported) continue;
    exports.push({ name: sym.name, kind: sym.kind, line: sym.startLine, isDefault: false });
  }
  for (const [name, decls] of sourceFile.getExportedDeclarations()) {
    if (name === 'default') {
      exports.push({ name: decls[0]?.getText().slice(0, 60) ?? 'default', kind: 'default', line: decls[0]?.getStartLineNumber() ?? 1, isDefault: true });
    }
  }

  // ---------- calls ----------
  const calls: ParsedCall[] = [];
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeName = calleeNameOf(call);
    if (!calleeName) continue;
    const caller = enclosingSymbolName(call);
    calls.push({
      caller,
      calleeExpression: call.getExpression().getText(),
      calleeName,
      calleeObject: calleeObjectOf(call),
      line: call.getStartLineNumber(),
      column: call.getNonWhitespaceStart() - call.getStartLinePos() + 1,
      argumentCount: call.getArguments().length,
    });
  }

  // ---------- jsx ----------
  const jsx: ParsedJsx[] = [];
  const jsxNodes: Node[] = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  for (const el of jsxNodes) {
    const tag = Node.isJsxOpeningElement(el) || Node.isJsxSelfClosingElement(el) ? el.getTagNameNode().getText() : null;
    if (!tag) continue;
    const isComponent = /^[A-Z]/.test(tag) || tag.includes('.');
    if (!isComponent) continue;
    jsx.push({
      parent: enclosingSymbolName(el),
      childName: tag,
      line: el.getStartLineNumber(),
      column: 1,
    });
  }

  // ---------- framework facts ----------
  const contextNames: string[] = [];
  for (const decl of sourceFile.getVariableDeclarations()) {
    const init = decl.getInitializer();
    if (init && Node.isCallExpression(init) && calleeNameOf(init) === 'createContext') {
      contextNames.push(decl.getName());
    }
  }
  const routeHandlerExports = symbols
    .filter((s) => s.exported && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(s.name))
    .map((s) => s.name);

  const directives: string[] = [];
  for (const stmt of sourceFile.getStatements().slice(0, 2)) {
    const text = stmt.getText().trim();
    if (text.startsWith("'use ") || text.startsWith('"use ')) {
      directives.push(text.replace(/^['"]|['"]$/g, ''));
    }
  }

  const httpTargets: HttpCallTarget[] = [];
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const t = httpTargetOf(call, enclosingSymbolName(call));
    if (t) httpTargets.push(t);
  }

  const serverRouteCalls: ServerRouteCall[] = [];
  const navigationCalls: NavigationCall[] = [];
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeNameOf(call);
    if (!name) continue;
    const obj = calleeObjectOf(call);
    const args = call.getArguments();
    const firstArg = args[0];
    const literal = (arg: Node | undefined): string | null => {
      if (!arg) return null;
      if (Node.isStringLiteral(arg)) return arg.getLiteralValue();
      if (Node.isNoSubstitutionTemplateLiteral(arg)) return arg.getLiteralText();
      if (Node.isTemplateExpression(arg)) return arg.getText().replace(/^`|`$/g, '');
      return null;
    };

    if (obj && /(app|router|server|route)/i.test(obj) && HTTP_METHODS.has(name.toLowerCase())) {
      const p = literal(firstArg);
      if (p && p.startsWith('/')) {
        const handlerArg = args.find((a, i) => i > 0 && (Node.isIdentifier(a) || Node.isArrowFunction(a) || Node.isFunctionExpression(a)));
        serverRouteCalls.push({
          caller: enclosingSymbolName(call),
          receiver: obj,
          method: name.toUpperCase(),
          path: p,
          handlerName: handlerArg && Node.isIdentifier(handlerArg) ? handlerArg.getText() : null,
          line: call.getStartLineNumber(),
        });
      }
    }

    if (['push', 'replace'].includes(name) && obj && /router|navigate|history/i.test(obj)) {
      const t = literal(firstArg);
      if (t && t.startsWith('/')) {
        navigationCalls.push({ caller: enclosingSymbolName(call), target: t, kind: name === 'replace' ? 'replace' : 'push', line: call.getStartLineNumber() });
      }
    } else if (name === 'navigate' || name === 'redirect') {
      const t = literal(firstArg);
      if (t && t.startsWith('/')) {
        navigationCalls.push({ caller: enclosingSymbolName(call), target: t, kind: name as 'navigate' | 'redirect', line: call.getStartLineNumber() });
      }
    }
  }

  const moduleText = sourceFile.getFullText();
  const frameworks = {
    contextNames,
    routeHandlerExports,
    directives,
    httpCallTargets: httpTargets,
    serverRouteCalls,
    navigationCalls,
    usesZustand: /from\s+['"]zustand['"]/.test(moduleText),
    usesRedux: /from\s+['"]@reduxjs\/toolkit['"]|from\s+['"]redux['"]/.test(moduleText),
  };

  // Remove the transient in-memory file to keep memory bounded on huge repos.
  try {
    project.removeSourceFile(sourceFile);
  } catch {
    /* ignore */
  }

  return {
    filePath: normalizePath(filePath),
    language: filePath.endsWith('.tsx') ? 'typescriptreact' : filePath.endsWith('.jsx') ? 'javascriptreact' : 'typescript',
    contentHash: sha256(content),
    lineCount: lineCount(content),
    symbols,
    imports,
    exports,
    calls,
    jsx,
    frameworks,
    parseErrors,
  };
}

export function resetParserProject(): void {
  sharedProject = null;
}
