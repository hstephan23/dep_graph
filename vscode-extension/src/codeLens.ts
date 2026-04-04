import * as vscode from 'vscode';
import { getCachedGraph, getDependencies, getDependents, toRelativePath } from './engine';

export class DepGraphCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const graph = getCachedGraph();
    if (!graph) { return []; }

    const fileId = toRelativePath(document.uri.fsPath);
    if (!fileId) { return []; }

    // Check if this file exists in the graph
    const node = graph.nodes.find(n => n.data.id === fileId);
    if (!node) { return []; }

    const deps = getDependencies(graph, fileId);
    const dependents = getDependents(graph, fileId);
    const range = new vscode.Range(0, 0, 0, 0);
    const lenses: vscode.CodeLens[] = [];

    // Inbound count
    lenses.push(new vscode.CodeLens(range, {
      title: `$(arrow-left) ${dependents.length} dependent${dependents.length !== 1 ? 's' : ''}`,
      command: 'depgraph.showDependents',
      tooltip: `${dependents.length} file(s) import this file`,
    }));

    // Outbound count
    lenses.push(new vscode.CodeLens(range, {
      title: `$(arrow-right) ${deps.length} import${deps.length !== 1 ? 's' : ''}`,
      command: 'depgraph.showDependencies',
      tooltip: `This file imports ${deps.length} file(s)`,
    }));

    // Metrics summary
    const d = node.data;
    lenses.push(new vscode.CodeLens(range, {
      title: `$(graph) depth ${d.depth} · impact ${d.impact} · stability ${d.stability.toFixed(2)}`,
      command: 'depgraph.showGraph',
      tooltip: 'Open dependency graph',
    }));

    // Cycle warning
    if (graph.has_cycles) {
      const inCycle = graph.cycles.some(cycle => cycle.includes(fileId));
      if (inCycle) {
        lenses.push(new vscode.CodeLens(range, {
          title: '$(warning) Part of dependency cycle',
          command: 'depgraph.findCycles',
          tooltip: 'This file is part of a circular dependency chain',
        }));
      }
    }

    return lenses;
  }
}
