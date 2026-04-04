import * as vscode from 'vscode';
import * as path from 'path';
import {
  GraphData, GraphNode, getGraph, getDependencies, getDependents,
  onGraphChanged,
} from './engine';
import { getConfig, getWorkspaceRoot } from './config';

// ── Dependency Tree ─────────────────────────────────────────────────

type TreeItemKind = 'root' | 'file' | 'dependency' | 'dependent';

interface DepTreeItem {
  kind: TreeItemKind;
  fileId: string;
  label: string;
  parentId?: string;
  direction?: 'imports' | 'imported-by';
}

export class DependencyTreeProvider implements vscode.TreeDataProvider<DepTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DepTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private graph: GraphData | null = null;

  constructor() {
    onGraphChanged((g) => {
      this.graph = g;
      this._onDidChangeTreeData.fire(undefined);
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: DepTreeItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);

    if (element.kind === 'root' || element.kind === 'file') {
      item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      item.iconPath = new vscode.ThemeIcon('file-code');
      item.contextValue = 'depgraph-file';

      // Click to open file
      const root = getWorkspaceRoot();
      if (root) {
        const uri = vscode.Uri.file(path.join(root, element.fileId));
        item.command = {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [uri],
        };
      }
    } else if (element.direction === 'imports') {
      item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      item.iconPath = new vscode.ThemeIcon('arrow-right');
      item.description = 'imports';
    } else if (element.direction === 'imported-by') {
      item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      item.iconPath = new vscode.ThemeIcon('arrow-left');
      item.description = 'imported by';
    } else {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.iconPath = new vscode.ThemeIcon('file');
      const root = getWorkspaceRoot();
      if (root) {
        const uri = vscode.Uri.file(path.join(root, element.fileId));
        item.command = {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [uri],
        };
      }
    }

    return item;
  }

  async getChildren(element?: DepTreeItem): Promise<DepTreeItem[]> {
    if (!this.graph) {
      try {
        this.graph = await getGraph();
      } catch {
        return [];
      }
    }

    // Top level: list all files sorted by depth (deepest first)
    if (!element) {
      return this.graph.nodes
        .slice()
        .sort((a, b) => b.data.depth - a.data.depth)
        .map(n => ({
          kind: 'root' as TreeItemKind,
          fileId: n.data.id,
          label: n.data.id,
        }));
    }

    // File expanded: show "Imports" and "Imported by" groups
    if (element.kind === 'root' || element.kind === 'file') {
      const deps = getDependencies(this.graph, element.fileId);
      const dependents = getDependents(this.graph, element.fileId);
      const children: DepTreeItem[] = [];

      if (deps.length > 0) {
        children.push({
          kind: 'dependency',
          fileId: element.fileId,
          label: `Imports (${deps.length})`,
          direction: 'imports',
          parentId: element.fileId,
        });
      }
      if (dependents.length > 0) {
        children.push({
          kind: 'dependent',
          fileId: element.fileId,
          label: `Imported by (${dependents.length})`,
          direction: 'imported-by',
          parentId: element.fileId,
        });
      }
      return children;
    }

    // "Imports" group expanded
    if (element.direction === 'imports' && element.parentId) {
      return getDependencies(this.graph, element.parentId).map(id => ({
        kind: 'file' as TreeItemKind,
        fileId: id,
        label: id,
      }));
    }

    // "Imported by" group expanded
    if (element.direction === 'imported-by' && element.parentId) {
      return getDependents(this.graph, element.parentId).map(id => ({
        kind: 'file' as TreeItemKind,
        fileId: id,
        label: id,
      }));
    }

    return [];
  }
}

// ── Cycles View ─────────────────────────────────────────────────────

interface CycleItem {
  kind: 'cycle' | 'member';
  label: string;
  cycleIndex?: number;
  fileId?: string;
}

export class CyclesTreeProvider implements vscode.TreeDataProvider<CycleItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CycleItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private graph: GraphData | null = null;

  constructor() {
    onGraphChanged((g) => {
      this.graph = g;
      this._onDidChangeTreeData.fire(undefined);
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: CycleItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);

    if (element.kind === 'cycle') {
      item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      item.iconPath = new vscode.ThemeIcon('warning');
    } else {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.iconPath = new vscode.ThemeIcon('file-code');
      const root = getWorkspaceRoot();
      if (root && element.fileId) {
        const uri = vscode.Uri.file(path.join(root, element.fileId));
        item.command = {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [uri],
        };
      }
    }

    return item;
  }

  async getChildren(element?: CycleItem): Promise<CycleItem[]> {
    if (!this.graph) {
      try {
        this.graph = await getGraph();
      } catch {
        return [];
      }
    }

    if (!element) {
      if (!this.graph.has_cycles || this.graph.cycles.length === 0) {
        return [{
          kind: 'member',
          label: 'No cycles detected',
        }];
      }
      return this.graph.cycles.map((cycle, i) => ({
        kind: 'cycle' as const,
        label: `Cycle ${i + 1} (${cycle.length} files)`,
        cycleIndex: i,
      }));
    }

    if (element.kind === 'cycle' && element.cycleIndex !== undefined) {
      const cycle = this.graph.cycles[element.cycleIndex];
      return cycle.map(fileId => ({
        kind: 'member' as const,
        label: fileId,
        fileId,
      }));
    }

    return [];
  }
}

// ── Metrics View ────────────────────────────────────────────────────

interface MetricItem {
  kind: 'file' | 'metric';
  label: string;
  fileId?: string;
  description?: string;
}

export class MetricsTreeProvider implements vscode.TreeDataProvider<MetricItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MetricItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private graph: GraphData | null = null;

  constructor() {
    onGraphChanged((g) => {
      this.graph = g;
      this._onDidChangeTreeData.fire(undefined);
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: MetricItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);

    if (element.kind === 'file') {
      item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      item.iconPath = new vscode.ThemeIcon('file-code');
      const root = getWorkspaceRoot();
      if (root && element.fileId) {
        const uri = vscode.Uri.file(path.join(root, element.fileId));
        item.command = {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [uri],
        };
      }
    } else {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.description = element.description;
      item.iconPath = new vscode.ThemeIcon('symbol-number');
    }

    return item;
  }

  async getChildren(element?: MetricItem): Promise<MetricItem[]> {
    if (!this.graph) {
      try {
        this.graph = await getGraph();
      } catch {
        return [];
      }
    }

    if (!element) {
      // Sort by risk severity, then impact descending
      const riskOrder: Record<string, number> = { critical: 0, high: 1, warning: 2, normal: 3, entry: 4, system: 5 };
      return this.graph.nodes
        .slice()
        .sort((a, b) => {
          const ra = riskOrder[a.data.risk] ?? 3;
          const rb = riskOrder[b.data.risk] ?? 3;
          if (ra !== rb) { return ra - rb; }
          return b.data.impact - a.data.impact;
        })
        .map(n => {
          const riskIcon = n.data.risk === 'critical' ? '🔴' : n.data.risk === 'high' ? '🟠' : n.data.risk === 'warning' ? '🟡' : n.data.risk === 'entry' ? '🟢' : '';
          return {
            kind: 'file' as const,
            label: n.data.id,
            fileId: n.data.id,
            description: `${riskIcon} ${n.data.risk_label ?? n.data.risk}  ·  impact: ${n.data.impact}`,
          };
        });
    }

    if (element.kind === 'file' && element.fileId) {
      const node = this.graph.nodes.find(n => n.data.id === element.fileId);
      if (!node) { return []; }
      const d = node.data;
      const config = getConfig();
      const depthFlag = d.depth > config.maxDepthWarning ? ' ⚠️' : '';
      return [
        { kind: 'metric', label: 'Risk', description: d.risk_label ?? d.risk },
        { kind: 'metric', label: 'Inbound', description: String(d.in_degree ?? 0) },
        { kind: 'metric', label: 'Outbound', description: String(d.out_degree ?? 0) },
        { kind: 'metric', label: 'Depth', description: `${d.depth}${depthFlag}` },
        { kind: 'metric', label: 'Impact', description: String(d.impact) },
        { kind: 'metric', label: 'Stability', description: d.stability.toFixed(2) },
        { kind: 'metric', label: 'Reach %', description: `${d.reach_pct.toFixed(1)}%` },
        { kind: 'metric', label: 'Language', description: d.language ?? 'unknown' },
      ];
    }

    return [];
  }
}
