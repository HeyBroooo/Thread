import {
  CONFIDENCE,
  makeEdge,
  makeNode,
  qualifiedSymbolName,
  type EdgeType,
  type GraphEdge,
  type GraphNode,
  type NodeType,
} from '@cbi/shared';
import {
  isServicePath,
  isTestPath,
  symbolKindToNodeType,
  type AnalyzedRepository,
  type ParsedFile,
  type ParsedSymbol,
} from '@cbi/parser';
import { analyzeGraph, type AnalysisContext, type AnalysisResult } from '@cbi/analyzer';

export interface BuiltGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  analysis: AnalysisResult;
  symbolIndex: Map<string, GraphNode>;
  fileIndex: Map<string, GraphNode>;
}

interface ImportBinding {
  filePath: string;
  exportedName: string;
  namespace: boolean;
}

export interface BuildOptions {
  /** Skip creating folder nodes (used for incremental updates). */
  includeFolders?: boolean;
}

export class GraphBuilder {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();
  private fileIndex = new Map<string, GraphNode>();
  private symbolIndex = new Map<string, GraphNode>();
  private symbolByName = new Map<string, GraphNode[]>();
  private bindings = new Map<string, Map<string, ImportBinding>>();
  private analyzed: AnalyzedRepository;
  private repositoryId: string;

  constructor(repositoryId: string, analyzed: AnalyzedRepository) {
    this.repositoryId = repositoryId;
    this.analyzed = analyzed;
  }

  private addNode(node: GraphNode): GraphNode {
    const existing = this.nodes.get(node.id);
    if (existing) {
      // Merge metadata so multiple producers enrich the same node.
      existing.metadata = { ...existing.metadata, ...node.metadata };
      return existing;
    }
    this.nodes.set(node.id, node);
    return node;
  }

  private addEdge(edge: GraphEdge): void {
    if (edge.sourceNodeId === edge.targetNodeId) return;
    if (!this.nodes.has(edge.sourceNodeId) || !this.nodes.has(edge.targetNodeId)) return;
    if (!this.edges.has(edge.id)) this.edges.set(edge.id, edge);
  }

  build(options: BuildOptions = {}): BuiltGraph {
    const includeFolders = options.includeFolders !== false;
    this.createRepositoryNode();
    if (includeFolders) this.createFolderNodes();
    this.createFileAndSymbolNodes();
    this.buildBindings();
    this.buildStructuralEdges();
    this.buildImportEdges();
    this.buildCallEdges();
    this.buildRenderEdges();
    this.buildTestEdges();
    this.buildFrameworkUsageEdges();

    const context: AnalysisContext = {
      repositoryId: this.repositoryId,
      analyzed: this.analyzed,
      symbolIndex: this.symbolIndex,
      fileIndex: this.fileIndex,
    };
    const analysis = analyzeGraph(context);
    for (const node of analysis.nodes) this.addNode(node);
    for (const edge of analysis.edges) this.addEdge(edge);

    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      analysis,
      symbolIndex: this.symbolIndex,
      fileIndex: this.fileIndex,
    };
  }

  // ------------------------------------------------------------------ nodes

  private createRepositoryNode(): void {
    const repoName = `${this.analyzed.config.packages[0]?.name ?? 'repository'}`;
    const node = makeNode({
      repositoryId: this.repositoryId,
      nodeType: 'repository',
      name: repoName,
      qualifiedName: 'repository',
      metadata: { root: this.analyzed.root, parserVersion: this.analyzed.parserVersion },
    });
    this.addNode(node);
  }

  private createFolderNodes(): void {
    const dirs = new Set<string>();
    for (const file of this.analyzed.files) {
      const parts = file.filePath.split('/');
      parts.pop();
      let current = '';
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        dirs.add(current);
      }
    }
    const folderByPath = new Map<string, GraphNode>();
    const sorted = [...dirs].sort((a, b) => a.split('/').length - b.split('/').length);
    for (const dir of sorted) {
      const node = makeNode({
        repositoryId: this.repositoryId,
        nodeType: 'folder',
        name: dir.split('/').pop() ?? dir,
        qualifiedName: `folder:${dir}`,
        metadata: { path: dir },
      });
      folderByPath.set(dir, this.addNode(node));
    }
    // folder -> folder CONTAINS, with top-level folders hanging off the
    // repository. Without the repository edge the containment graph is a set
    // of disconnected roots and tree layouts can only draw a fragment.
    const repoNode = [...this.nodes.values()].find((n) => n.nodeType === 'repository');
    for (const dir of sorted) {
      const parts = dir.split('/');
      parts.pop();
      const parent = parts.join('/');
      const child = folderByPath.get(dir);
      if (!child) continue;
      const parentNode = parent ? folderByPath.get(parent) : repoNode;
      if (!parentNode) continue;
      this.addEdge(
        makeEdge({
          repositoryId: this.repositoryId,
          edgeType: 'CONTAINS',
          sourceNodeId: parentNode.id,
          targetNodeId: child.id,
          evidence: parent ? `${parent} contains ${dir}` : `repository contains ${dir}`,
          confidence: CONFIDENCE.deterministic,
        }),
      );
    }
    this.folderIndex = folderByPath;
  }

  private folderIndex = new Map<string, GraphNode>();

  private createFileAndSymbolNodes(): void {
    const repoNode = [...this.nodes.values()].find((n) => n.nodeType === 'repository');
    for (const file of this.analyzed.files) {
      const node = makeNode({
        repositoryId: this.repositoryId,
        nodeType: 'file',
        name: file.filePath.split('/').pop() ?? file.filePath,
        filePath: file.filePath,
        language: file.language,
        startLine: 1,
        endLine: file.lineCount,
        contentHash: file.contentHash,
        qualifiedName: `file:${file.filePath}`,
        metadata: { isTest: isTestPath(file.filePath), path: file.filePath },
      });
      this.fileIndex.set(file.filePath, this.addNode(node));

      // folder CONTAINS file
      const dir = file.filePath.split('/').slice(0, -1).join('/');
      const folder = dir ? this.folderIndex.get(dir) : undefined;
      if (folder) {
        this.addEdge(
          makeEdge({
            repositoryId: this.repositoryId,
            edgeType: 'CONTAINS',
            sourceNodeId: folder.id,
            targetNodeId: node.id,
            evidence: `${dir} contains ${file.filePath}`,
            confidence: CONFIDENCE.deterministic,
          }),
        );
      } else if (repoNode) {
        this.addEdge(
          makeEdge({
            repositoryId: this.repositoryId,
            edgeType: 'CONTAINS',
            sourceNodeId: repoNode.id,
            targetNodeId: node.id,
            evidence: `${file.filePath} is at the repository root`,
            confidence: CONFIDENCE.deterministic,
          }),
        );
      }

      for (const sym of file.symbols) {
        const symbolNode = this.createSymbolNode(file, sym);
        const list = this.symbolByName.get(sym.name) ?? [];
        list.push(symbolNode);
        this.symbolByName.set(sym.name, list);
      }
    }

    // configuration + package nodes from manifests
    for (const inv of this.analyzed.inventory.files) {
      if (inv.kind === 'package-manifest') {
        const node = makeNode({
          repositoryId: this.repositoryId,
          nodeType: 'package',
          name: inv.filePath,
          qualifiedName: `package:${inv.filePath}`,
          metadata: { path: inv.filePath },
        });
        const added = this.addNode(node);
        const repo = [...this.nodes.values()].find((n) => n.nodeType === 'repository');
        if (repo) {
          this.addEdge(
            makeEdge({
              repositoryId: this.repositoryId,
              edgeType: 'CONTAINS',
              sourceNodeId: repo.id,
              targetNodeId: added.id,
              evidence: `${inv.filePath} is a package manifest`,
              confidence: CONFIDENCE.deterministic,
              extractionMethod: 'config_analysis',
            }),
          );
        }
      } else if (inv.kind === 'config') {
        const node = makeNode({
          repositoryId: this.repositoryId,
          nodeType: 'configuration',
          name: inv.filePath,
          qualifiedName: `config:${inv.filePath}`,
          metadata: { path: inv.filePath },
        });
        const added = this.addNode(node);
        const repo = [...this.nodes.values()].find((n) => n.nodeType === 'repository');
        if (repo) {
          this.addEdge(
            makeEdge({
              repositoryId: this.repositoryId,
              edgeType: 'CONTAINS',
              sourceNodeId: repo.id,
              targetNodeId: added.id,
              evidence: `${inv.filePath} is a configuration file`,
              confidence: CONFIDENCE.deterministic,
              extractionMethod: 'config_analysis',
            }),
          );
        }
      }
    }
  }

  private createSymbolNode(file: ParsedFile, sym: ParsedSymbol): GraphNode {
    let nodeType: NodeType = symbolKindToNodeType(sym, file.filePath);
    if (sym.kind === 'hook') nodeType = 'hook';
    if (sym.kind === 'component') nodeType = 'component';
    if (sym.kind === 'context') nodeType = 'context';
    if (sym.kind === 'store') nodeType = 'store';
    if (nodeType === 'function' && isServicePath(file.filePath) && sym.exported) nodeType = 'service';

    const node = makeNode({
      repositoryId: this.repositoryId,
      nodeType,
      name: sym.name,
      filePath: file.filePath,
      language: file.language,
      startLine: sym.startLine,
      endLine: sym.endLine,
      qualifiedName: qualifiedSymbolName(file.filePath, sym.name),
      metadata: {
        exported: sym.exported,
        async: sym.isAsync,
        kind: sym.kind,
        hookCalls: sym.hookCalls,
        ...sym.metadata,
      },
    });
    const added = this.addNode(node);
    this.symbolIndex.set(`${file.filePath}#${sym.name}`, added);
    return added;
  }

  // ------------------------------------------------------------------ bindings

  private buildBindings(): void {
    for (const file of this.analyzed.files) {
      const map = new Map<string, ImportBinding>();
      for (const imp of file.imports) {
        if (!imp.resolvedFilePath) continue;
        if (imp.defaultImport) {
          map.set(imp.defaultImport, { filePath: imp.resolvedFilePath, exportedName: 'default', namespace: false });
        }
        if (imp.namespaceImport) {
          map.set(imp.namespaceImport, { filePath: imp.resolvedFilePath, exportedName: '*', namespace: true });
        }
        for (const n of imp.namedImports) {
          map.set(n.alias ?? n.name, { filePath: imp.resolvedFilePath, exportedName: n.name, namespace: false });
        }
      }
      this.bindings.set(file.filePath, map);
    }
  }

  private resolveSymbol(fromFile: string, name: string, objectName: string | null): { node: GraphNode; confidence: number } | null {
    const bindings = this.bindings.get(fromFile);
    if (bindings) {
      if (objectName) {
        const nsBinding = bindings.get(objectName);
        if (nsBinding?.namespace) {
          const node = this.symbolIndex.get(`${nsBinding.filePath}#${name}`);
          if (node) return { node, confidence: CONFIDENCE.strongStatic };
        }
      }
      const binding = bindings.get(name);
      if (binding && !binding.namespace) {
        const node =
          binding.exportedName === 'default'
            ? this.findDefaultExport(binding.filePath)
            : this.symbolIndex.get(`${binding.filePath}#${binding.exportedName}`);
        if (node) return { node, confidence: CONFIDENCE.strongStatic };
      }
      if (objectName) {
        const objBinding = bindings.get(objectName);
        if (objBinding && !objBinding.namespace) {
          const serviceNode =
            objBinding.exportedName === 'default'
              ? this.findDefaultExport(objBinding.filePath)
              : this.symbolIndex.get(`${objBinding.filePath}#${objBinding.exportedName}`);
          if (serviceNode) return { node: serviceNode, confidence: CONFIDENCE.probable };
        }
      }
    }

    // same-file symbol
    const local = this.symbolIndex.get(`${fromFile}#${name}`);
    if (local) return { node: local, confidence: CONFIDENCE.deterministic };

    // globally unique symbol name
    const candidates = this.symbolByName.get(name);
    if (candidates && candidates.length === 1) {
      return { node: candidates[0]!, confidence: CONFIDENCE.weak };
    }
    return null;
  }

  private findDefaultExport(filePath: string): GraphNode | null {
    for (const [key, node] of this.symbolIndex) {
      if (key.startsWith(`${filePath}#`) && node.metadata['exported']) return node;
    }
    return null;
  }

  // ------------------------------------------------------------------ edges

  private buildStructuralEdges(): void {
    for (const file of this.analyzed.files) {
      const fileNode = this.fileIndex.get(file.filePath)!;
      for (const sym of file.symbols) {
        const symbolNode = this.symbolIndex.get(`${file.filePath}#${sym.name}`);
        if (!symbolNode) continue;
        this.addEdge(
          makeEdge({
            repositoryId: this.repositoryId,
            edgeType: 'CONTAINS',
            sourceNodeId: fileNode.id,
            targetNodeId: symbolNode.id,
            evidence: `${file.filePath} declares ${sym.kind} ${sym.name} (lines ${sym.startLine}-${sym.endLine})`,
            confidence: CONFIDENCE.deterministic,
            sourceFile: file.filePath,
            sourceLine: sym.startLine,
          }),
        );
        this.addEdge(
          makeEdge({
            repositoryId: this.repositoryId,
            edgeType: 'DEFINED_IN',
            sourceNodeId: symbolNode.id,
            targetNodeId: fileNode.id,
            evidence: `${sym.name} is defined in ${file.filePath}:${sym.startLine}`,
            confidence: CONFIDENCE.deterministic,
            sourceFile: file.filePath,
            sourceLine: sym.startLine,
          }),
        );
        if (sym.exported) {
          this.addEdge(
            makeEdge({
              repositoryId: this.repositoryId,
              edgeType: 'EXPORTS',
              sourceNodeId: fileNode.id,
              targetNodeId: symbolNode.id,
              evidence: `export ${sym.kind} ${sym.name}`,
              confidence: CONFIDENCE.deterministic,
              sourceFile: file.filePath,
              sourceLine: sym.startLine,
            }),
          );
        }
      }
    }
  }

  private buildImportEdges(): void {
    for (const file of this.analyzed.files) {
      const fileNode = this.fileIndex.get(file.filePath);
      if (!fileNode) continue;
      for (const imp of file.imports) {
        if (!imp.resolvedFilePath) {
          if (imp.resolution === 'package' || (imp.resolution === 'relative' && !imp.resolvedFilePath)) {
            // unresolved relative import -> record an evidence-backed warning edge to the file itself is not useful;
            // skip, validation surfaces counts.
          }
          continue;
        }
        const target = this.fileIndex.get(imp.resolvedFilePath);
        if (!target) continue;
        this.addEdge(
          makeEdge({
            repositoryId: this.repositoryId,
            edgeType: 'IMPORTS',
            sourceNodeId: fileNode.id,
            targetNodeId: target.id,
            evidence: `import ${imp.defaultImport ?? imp.namespaceImport ?? `{ ${imp.namedImports.map((n) => n.name).join(', ')} }`} from '${imp.moduleSpecifier}'`,
            confidence: CONFIDENCE.deterministic,
            sourceFile: file.filePath,
            sourceLine: imp.line,
            metadata: { moduleSpecifier: imp.moduleSpecifier, resolution: imp.resolution },
          }),
        );

        for (const n of imp.namedImports) {
          const targetSymbol = this.symbolIndex.get(`${imp.resolvedFilePath}#${n.name}`);
          if (!targetSymbol) continue;
          this.addEdge(
            makeEdge({
              repositoryId: this.repositoryId,
              edgeType: 'REFERENCES',
              sourceNodeId: fileNode.id,
              targetNodeId: targetSymbol.id,
              evidence: `import { ${n.name}${n.alias ? ` as ${n.alias}` : ''} } from '${imp.moduleSpecifier}'`,
              confidence: CONFIDENCE.deterministic,
              sourceFile: file.filePath,
              sourceLine: imp.line,
            }),
          );
        }
      }
    }
  }

  /**
   * Resolve the symbol a call site belongs to.
   *
   * Nested handlers (e.g. an arrow handler inside a component) are not graph
   * nodes, so we fall back to the smallest enclosing declared symbol that
   * contains the call line — attributing the call to the owning component,
   * hook or service rather than dropping the relationship.
   */
  private resolveCallerNode(file: ParsedFile, call: { caller: string; line: number }): GraphNode | null {
    if (call.caller !== '<module>') {
      const direct = this.symbolIndex.get(`${file.filePath}#${call.caller}`);
      if (direct) return direct;
    }
    let best: GraphNode | null = null;
    let bestSpan = Number.POSITIVE_INFINITY;
    for (const sym of file.symbols) {
      const node = this.symbolIndex.get(`${file.filePath}#${sym.name}`);
      if (!node) continue;
      const start = sym.startLine;
      const end = sym.endLine;
      if (call.line < start || call.line > end) continue;
      const span = end - start;
      if (span < bestSpan) {
        best = node;
        bestSpan = span;
      }
    }
    return best ?? this.fileIndex.get(file.filePath) ?? null;
  }

  private buildCallEdges(): void {
    for (const file of this.analyzed.files) {
      for (const call of file.calls) {
        const caller = this.resolveCallerNode(file, call);
        if (!caller) continue;

        const resolved = this.resolveSymbol(file.filePath, call.calleeName, call.calleeObject);
        if (!resolved) continue;
        if (resolved.node.id === caller.id) continue;
        // Hook consumption is modelled as USES; everything else is a CALLS.
        const edgeType: EdgeType = resolved.node.nodeType === 'hook' ? 'USES' : 'CALLS';
        this.addEdge(
          makeEdge({
            repositoryId: this.repositoryId,
            edgeType,
            sourceNodeId: caller.id,
            targetNodeId: resolved.node.id,
            evidence: `${call.calleeExpression}(${call.argumentCount} args) at ${file.filePath}:${call.line}`,
            confidence: resolved.confidence,
            extractionMethod: resolved.confidence >= CONFIDENCE.strongStatic ? 'typescript_ast' : 'static_inference',
            sourceFile: file.filePath,
            sourceLine: call.line,
            sourceColumn: call.column,
          }),
        );
      }
    }
  }

  private buildRenderEdges(): void {
    for (const file of this.analyzed.files) {
      for (const jsx of file.jsx) {
        const parent =
          jsx.parent === '<module>'
            ? this.fileIndex.get(file.filePath)
            : this.symbolIndex.get(`${file.filePath}#${jsx.parent}`);
        if (!parent) continue;
        const resolved = this.resolveSymbol(file.filePath, jsx.childName, jsx.childName.includes('.') ? jsx.childName.split('.')[0]! : null);
        if (!resolved) continue;
        if (resolved.node.id === parent.id) continue;
        if (resolved.node.nodeType !== 'component' && resolved.node.nodeType !== 'context') continue;
        this.addEdge(
          makeEdge({
            repositoryId: this.repositoryId,
            edgeType: 'RENDERS',
            sourceNodeId: parent.id,
            targetNodeId: resolved.node.id,
            evidence: `<${jsx.childName} /> rendered in ${jsx.parent} at ${file.filePath}:${jsx.line}`,
            confidence: resolved.confidence,
            sourceFile: file.filePath,
            sourceLine: jsx.line,
            sourceColumn: jsx.column,
          }),
        );
      }
    }
  }

  private buildTestEdges(): void {
    for (const file of this.analyzed.files) {
      if (!isTestPath(file.filePath)) continue;
      const testFile = this.fileIndex.get(file.filePath);
      if (!testFile) continue;
      for (const imp of file.imports) {
        if (!imp.resolvedFilePath) continue;
        const target = this.fileIndex.get(imp.resolvedFilePath);
        if (!target) continue;
        this.addEdge(
          makeEdge({
            repositoryId: this.repositoryId,
            edgeType: 'TESTS',
            sourceNodeId: testFile.id,
            targetNodeId: target.id,
            evidence: `test imports '${imp.moduleSpecifier}'`,
            confidence: CONFIDENCE.strongStatic,
            sourceFile: file.filePath,
            sourceLine: imp.line,
          }),
        );
        for (const n of imp.namedImports) {
          const symbol = this.symbolIndex.get(`${imp.resolvedFilePath}#${n.name}`);
          if (!symbol) continue;
          this.addEdge(
            makeEdge({
              repositoryId: this.repositoryId,
              edgeType: 'TESTS',
              sourceNodeId: testFile.id,
              targetNodeId: symbol.id,
              evidence: `test imports { ${n.name} } from '${imp.moduleSpecifier}'`,
              confidence: CONFIDENCE.strongStatic,
              sourceFile: file.filePath,
              sourceLine: imp.line,
            }),
          );
        }
      }
    }
  }

  private buildFrameworkUsageEdges(): void {
    for (const file of this.analyzed.files) {
      for (const sym of file.symbols) {
        const node = this.symbolIndex.get(`${file.filePath}#${sym.name}`);
        if (!node) continue;

        // USES_CONTEXT: useContext(Context) where Context resolves to a context node
        for (const hook of sym.hookCalls) {
          if (hook === 'useContext') {
            for (const contextName of file.frameworks.contextNames) {
              const ctxNode = this.symbolIndex.get(`${file.filePath}#${contextName}`);
              if (ctxNode) {
                this.addEdge(
                  makeEdge({
                    repositoryId: this.repositoryId,
                    edgeType: 'USES_CONTEXT',
                    sourceNodeId: node.id,
                    targetNodeId: ctxNode.id,
                    evidence: `${sym.name} consumes context ${contextName}`,
                    confidence: CONFIDENCE.probable,
                    sourceFile: file.filePath,
                    sourceLine: sym.startLine,
                  }),
                );
              }
            }
          }
        }

        // USES_STORE: calling a resolved store hook
        for (const call of file.calls) {
          if (this.resolveCallerNode(file, call)?.id !== node.id) continue;
          const resolved = this.resolveSymbol(file.filePath, call.calleeName, call.calleeObject);
          if (!resolved) continue;
          if (resolved.node.nodeType === 'store') {
            this.addEdge(
              makeEdge({
                repositoryId: this.repositoryId,
                edgeType: 'USES_STORE',
                sourceNodeId: node.id,
                targetNodeId: resolved.node.id,
                evidence: `${sym.name} uses store ${resolved.node.name}`,
                confidence: CONFIDENCE.probable,
                sourceFile: file.filePath,
                sourceLine: call.line,
              }),
            );
          }

        }
      }
    }
  }
}

export function buildGraph(repositoryId: string, analyzed: AnalyzedRepository, options?: BuildOptions): BuiltGraph {
  return new GraphBuilder(repositoryId, analyzed).build(options);
}
