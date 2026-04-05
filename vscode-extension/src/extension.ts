import * as vscode from 'vscode';
import { getGraph, stopServer, onGraphChanged, setDepgraphRoot } from './engine';
import { getConfig } from './config';
import { DependencyTreeProvider, CyclesTreeProvider, MetricsTreeProvider } from './sidebar';
import { GraphWebviewProvider } from './webview';
import { DepGraphCodeLensProvider } from './codeLens';
import { DepGraphHoverProvider } from './hover';
import { DepGraphDiagnostics } from './diagnostics';
import * as commands from './commands';

export function activate(context: vscode.ExtensionContext) {
  const extensionUri = context.extensionUri;

  // Tell the engine where the DepGraph Python source lives
  // (one directory above the extension: <depgraph>/vscode-extension)
  setDepgraphRoot(context.extensionPath);

  // ── Sidebar tree views ──────────────────────────────────────────
  const depTree = new DependencyTreeProvider();
  const cyclesTree = new CyclesTreeProvider();
  const metricsTree = new MetricsTreeProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('depgraph.dependencyTree', depTree),
    vscode.window.registerTreeDataProvider('depgraph.cycles', cyclesTree),
    vscode.window.registerTreeDataProvider('depgraph.metrics', metricsTree),
  );

  // ── CodeLens ────────────────────────────────────────────────────
  const codeLens = new DepGraphCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLens),
  );

  // ── Hover provider (mini dependency graph on import hover) ─────
  const hoverProvider = new DepGraphHoverProvider();
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider),
  );

  // Refresh CodeLens when graph changes
  context.subscriptions.push(
    onGraphChanged(() => codeLens.refresh()),
  );

  // ── Diagnostics ─────────────────────────────────────────────────
  const diagnostics = new DepGraphDiagnostics();
  context.subscriptions.push(diagnostics);

  // ── Commands ────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('depgraph.showGraph', () =>
      commands.showGraph(extensionUri)),

    vscode.commands.registerCommand('depgraph.findCycles', () =>
      commands.findCycles(extensionUri)),

    vscode.commands.registerCommand('depgraph.showDependents', () =>
      commands.showDependents(extensionUri)),

    vscode.commands.registerCommand('depgraph.showDependencies', () =>
      commands.showDependencies(extensionUri)),

    vscode.commands.registerCommand('depgraph.blastRadius', () =>
      commands.blastRadius(extensionUri)),

    vscode.commands.registerCommand('depgraph.refresh', async () => {
      await getGraph(true);
      depTree.refresh();
      cyclesTree.refresh();
      metricsTree.refresh();
      codeLens.refresh();

      // If webview is open, refresh it too
      if (GraphWebviewProvider.currentPanel) {
        await GraphWebviewProvider.currentPanel.loadGraph();
      }

      vscode.window.showInformationMessage('DepGraph: Refreshed');
    }),

    vscode.commands.registerCommand('depgraph.exportJSON', commands.exportJSON),
    vscode.commands.registerCommand('depgraph.exportDOT', commands.exportDOT),
    vscode.commands.registerCommand('depgraph.exportMermaid', commands.exportMermaid),
  );

  // ── File watcher for auto-refresh ──────────────────────────────
  const config = getConfig();
  if (config.autoRefresh) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{py,js,ts,jsx,tsx,java,go,rs,c,cpp,h,hpp,cs,swift,rb,kt,kts,scala,sc,php,dart,ex,exs}');

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const debouncedRefresh = () => {
      if (debounceTimer) { clearTimeout(debounceTimer); }
      debounceTimer = setTimeout(async () => {
        try {
          await getGraph(true);
        } catch {
          // Silently ignore auto-refresh failures
        }
      }, 2000); // 2s debounce
    };

    watcher.onDidChange(debouncedRefresh);
    watcher.onDidCreate(debouncedRefresh);
    watcher.onDidDelete(debouncedRefresh);
    context.subscriptions.push(watcher);
  }

  // ── Initial graph load ──────────────────────────────────────────
  getGraph().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[DepGraph] Initial graph load failed:', msg);
    // Show a subtle warning so the user knows something's off
    vscode.window.showWarningMessage(
      `DepGraph: Could not analyze workspace — ${msg}. Check that Python 3 is installed.`
    );
  });

  // ── Status bar ──────────────────────────────────────────────────
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(type-hierarchy) DepGraph';
  statusBar.tooltip = 'Open dependency graph';
  statusBar.command = 'depgraph.showGraph';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Update status bar with cycle count when graph loads
  context.subscriptions.push(
    onGraphChanged((graph) => {
      if (graph.has_cycles && graph.cycles.length > 0) {
        statusBar.text = `$(type-hierarchy) DepGraph $(warning) ${graph.cycles.length}`;
        statusBar.tooltip = `${graph.cycles.length} dependency cycle(s) found`;
      } else {
        statusBar.text = '$(type-hierarchy) DepGraph';
        statusBar.tooltip = 'Open dependency graph';
      }
    }),
  );
}

export function deactivate() {
  stopServer();
}
