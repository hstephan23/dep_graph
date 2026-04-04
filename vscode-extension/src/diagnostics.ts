import * as vscode from 'vscode';
import * as path from 'path';
import { GraphData, onGraphChanged } from './engine';
import { getConfig, getWorkspaceRoot } from './config';

export class DepGraphDiagnostics {
  private collection: vscode.DiagnosticCollection;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection('depgraph');

    this.disposables.push(
      onGraphChanged((graph) => this.update(graph)),
    );
  }

  update(graph: GraphData): void {
    this.collection.clear();
    const root = getWorkspaceRoot();
    if (!root) { return; }

    const config = getConfig();
    const diagnosticMap = new Map<string, vscode.Diagnostic[]>();

    const addDiag = (fileId: string, diag: vscode.Diagnostic) => {
      const absPath = path.join(root, fileId);
      const uri = vscode.Uri.file(absPath).toString();
      if (!diagnosticMap.has(uri)) {
        diagnosticMap.set(uri, []);
      }
      diagnosticMap.get(uri)!.push(diag);
    };

    // ── Cycle warnings ────────────────────────────────────────────
    if (graph.has_cycles) {
      for (const cycle of graph.cycles) {
        const cycleStr = cycle.join(' → ') + ' → ' + cycle[0];
        for (const fileId of cycle) {
          const diag = new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 0),
            `Circular dependency: ${cycleStr}`,
            vscode.DiagnosticSeverity.Warning,
          );
          diag.source = 'DepGraph';
          diag.code = 'cycle';
          addDiag(fileId, diag);
        }
      }
    }

    // ── Depth warnings ────────────────────────────────────────────
    for (const node of graph.nodes) {
      if (node.data.depth > config.maxDepthWarning) {
        const diag = new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 0),
          `Deep dependency chain: depth ${node.data.depth} exceeds threshold ${config.maxDepthWarning}`,
          vscode.DiagnosticSeverity.Information,
        );
        diag.source = 'DepGraph';
        diag.code = 'depth';
        addDiag(node.data.id, diag);
      }
    }

    // ── High-impact warnings ──────────────────────────────────────
    // Warn about files with very high reach (> 50% of codebase depends on them)
    for (const node of graph.nodes) {
      if (node.data.reach_pct > 50) {
        const diag = new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 0),
          `High-impact file: ${node.data.reach_pct.toFixed(1)}% of the codebase transitively depends on this file`,
          vscode.DiagnosticSeverity.Hint,
        );
        diag.source = 'DepGraph';
        diag.code = 'high-impact';
        addDiag(node.data.id, diag);
      }
    }

    // Apply diagnostics
    for (const [uriStr, diags] of diagnosticMap) {
      this.collection.set(vscode.Uri.parse(uriStr), diags);
    }
  }

  dispose(): void {
    this.collection.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
