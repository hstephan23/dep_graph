import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getGraph, getBlastRadius, getDependents, getDependencies, getChurn, getChurnFromRemote } from './engine';

// Load shared constants — single source of truth with the Python backend and web UI.
const SHARED_CONSTANTS_PATH = path.join(__dirname, '..', 'shared', 'constants.json');
let _sharedConstants: { risk_colors: Record<string, string>; risk_labels: Record<string, string> };
try {
  _sharedConstants = JSON.parse(fs.readFileSync(SHARED_CONSTANTS_PATH, 'utf-8'));
} catch {
  _sharedConstants = {
    risk_colors: { critical: '#ef4444', high: '#f97316', warning: '#eab308', normal: '#3b82f6', entry: '#22c55e', system: '#6b7280' },
    risk_labels: { critical: 'Critical / God file', high: 'High influence', warning: 'High dependency', normal: 'Normal', entry: 'Entry point / leaf', system: 'System / external' },
  };
}

export class GraphWebviewProvider {
  public static currentPanel: GraphWebviewProvider | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (msg) => this.handleMessage(msg),
      null,
      this.disposables,
    );

    this.panel.webview.html = this.getHtml();
  }

  public static create(extensionUri: vscode.Uri): GraphWebviewProvider {
    if (GraphWebviewProvider.currentPanel) {
      GraphWebviewProvider.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return GraphWebviewProvider.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'depgraph.graphView',
      'DepGraph',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );

    GraphWebviewProvider.currentPanel = new GraphWebviewProvider(panel, extensionUri);
    return GraphWebviewProvider.currentPanel;
  }

  public async loadGraph(): Promise<void> {
    try {
      const data = await getGraph(true);
      this.panel.webview.postMessage({ type: 'graphData', data });
      // Eagerly fetch churn data in background
      getChurn().then(churn => {
        this.panel.webview.postMessage({ type: 'churnData', data: churn });
      }).catch(() => { /* ignore churn errors */ });
    } catch (err: any) {
      this.panel.webview.postMessage({
        type: 'error',
        message: err.message ?? 'Failed to load graph',
      });
    }
  }

  public focusNode(nodeId: string): void {
    this.panel.webview.postMessage({ type: 'focusNode', nodeId });
  }

  public highlightNodes(nodeIds: string[], label?: string): void {
    this.panel.webview.postMessage({ type: 'highlightNodes', nodeIds, label });
  }

  private async handleMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'ready':
        await this.loadGraph();
        break;
      case 'openFile': {
        const folders = vscode.workspace.workspaceFolders;
        if (folders) {
          const uri = vscode.Uri.file(path.join(folders[0].uri.fsPath, msg.fileId));
          vscode.window.showTextDocument(uri);
        }
        break;
      }
      case 'requestBlastRadius': {
        const graph = await getGraph();
        const radius = getBlastRadius(graph, msg.nodeId);
        this.panel.webview.postMessage({
          type: 'blastRadiusResult',
          nodeId: msg.nodeId,
          affected: Array.from(radius),
        });
        break;
      }
      case 'requestDependents': {
        const g = await getGraph();
        const deps = getDependents(g, msg.nodeId);
        this.panel.webview.postMessage({
          type: 'dependentsResult',
          nodeId: msg.nodeId,
          dependents: deps,
        });
        break;
      }
      case 'requestDependencies': {
        const g2 = await getGraph();
        const imports = getDependencies(g2, msg.nodeId);
        this.panel.webview.postMessage({
          type: 'dependenciesResult',
          nodeId: msg.nodeId,
          dependencies: imports,
        });
        break;
      }
      case 'requestChurn': {
        const churnResult = await getChurn();
        this.panel.webview.postMessage({ type: 'churnData', data: churnResult });
        break;
      }
      case 'requestChurnRemote': {
        const remoteResult = await getChurnFromRemote(msg.repo);
        this.panel.webview.postMessage({ type: 'churnData', data: remoteResult });
        break;
      }
      case 'exportJSON': {
        const graph = await getGraph();
        const doc = await vscode.workspace.openTextDocument({
          content: JSON.stringify(graph, null, 2),
          language: 'json',
        });
        vscode.window.showTextDocument(doc);
        break;
      }
    }
  }

  private dispose(): void {
    GraphWebviewProvider.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private getHtml(): string {
    const nonce = getNonce();
    const logoUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'icon.png')
    );
    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net;
             style-src 'unsafe-inline' https://fonts.googleapis.com;
             font-src https://fonts.gstatic.com;
             img-src data: ${this.panel.webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.31.0/cytoscape.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/dagre/0.8.5/dagre.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/cytoscape-dagre@2.5.0/cytoscape-dagre.min.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #1e1e1e;
      --text: #cccccc;
      --primary: #6366f1;
      --border: #333;
      --surface: #252526;
      --danger: #ef4444;
      --success: #10b981;
      --warning: #f59e0b;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      overflow: hidden;
      height: 100vh;
    }
    #cy { width: 100%; height: calc(100vh - 48px); padding-top: 16px; box-sizing: border-box; }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      height: 48px;
    }
    .toolbar button {
      background: none;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
    }
    .toolbar button:hover { background: var(--border); }
    .toolbar button.active { background: var(--primary); border-color: var(--primary); color: #fff; }
    .search-input {
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-family: inherit;
      width: 200px;
    }
    .search-input:focus { outline: none; border-color: var(--primary); }
    .spacer { flex: 1; }
    .stats {
      font-size: 11px;
      opacity: 0.7;
      white-space: nowrap;
    }
    .cycle-badge {
      display: none;
      align-items: center;
      gap: 4px;
      background: rgba(239,68,68,0.15);
      color: var(--danger);
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
    }
    .cycle-badge.visible { display: flex; }
    .tooltip {
      position: absolute;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 12px;
      pointer-events: none;
      z-index: 100;
      display: none;
      max-width: 350px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .tooltip.visible { display: block; }
    .tooltip-title { font-weight: 600; margin-bottom: 4px; }
    .tooltip-row { display: flex; justify-content: space-between; gap: 16px; }
    .tooltip-label { opacity: 0.7; }
    .loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      opacity: 0.7;
    }
    .loading-logo {
      width: 48px; height: 48px;
      border-radius: 22%;
      animation: breathe 1.8s ease-in-out infinite;
      margin: 0 auto 12px;
    }
    @keyframes breathe {
      0%, 100% { transform: scale(1);    opacity: 0.55; }
      50%      { transform: scale(1.10); opacity: 1;    }
    }
    .context-menu {
      position: absolute;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 0;
      z-index: 200;
      display: none;
      min-width: 180px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    }
    .context-menu.visible { display: block; }
    .context-menu button {
      display: block;
      width: 100%;
      text-align: left;
      background: none;
      border: none;
      color: var(--text);
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
    }
    .context-menu button:hover { background: var(--border); }
    .color-toggle { display: flex; gap: 2px; }
    .color-toggle button { font-size: 11px; padding: 2px 8px; }
    .legend {
      position: absolute; bottom: 12px; left: 12px;
      display: flex; gap: 10px; align-items: center;
      background: rgba(37,37,38,0.85); border: 1px solid var(--border);
      border-radius: 6px; padding: 4px 10px; font-size: 11px;
      z-index: 50;
    }
    .legend-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }

    /* View toggle (Graph / Tree / Layers) */
    .view-toggle { display: flex; gap: 2px; margin-right: 6px; }
    .view-toggle button { font-size: 11px; padding: 2px 8px; }

    /* ===== Layers Panel ===== */
    .layers-panel {
      position: absolute; top: 56px; right: 12px; z-index: 50;
      width: 280px; max-height: calc(100vh - 80px);
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      overflow: hidden; display: flex; flex-direction: column;
    }
    .layers-panel-header {
      padding: 8px 12px; font-size: 12px; font-weight: 600;
      border-bottom: 1px solid var(--border);
    }
    .layers-panel-body { padding: 10px 12px; overflow-y: auto; font-size: 11px; }
    .layers-input-row { display: flex; gap: 4px; margin-bottom: 6px; }
    .layers-input-row input {
      flex: 1; font-size: 11px; padding: 4px 8px;
      background: var(--bg); border: 1px solid var(--border);
      border-radius: 4px; color: var(--text);
    }
    .layers-input-row button {
      font-size: 11px; padding: 4px 10px; border-radius: 4px;
      background: var(--accent); color: white; border: none; cursor: pointer;
    }
    .layers-hint { color: var(--text-dim); margin-bottom: 8px; line-height: 1.4; font-size: 10px; }

    /* Swim-lane layer labels (DOM pills positioned over cy container) */
    .layer-swim-label {
      position: absolute; display: flex; align-items: center; gap: 8px;
      pointer-events: none; z-index: 6;
      font-size: 0.72rem; font-weight: 600; letter-spacing: 0.05em;
      text-transform: uppercase; color: var(--text-dim); white-space: nowrap;
    }
    .layer-depth-num {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 32px; height: 24px; border-radius: 12px;
      background: var(--surface); border: 1px solid var(--border);
      font-size: 0.68rem; font-weight: 700; color: var(--text);
      padding: 0 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.15);
    }
    .layer-depth-count { font-size: 0.62rem; font-weight: 500; color: var(--text-dim); opacity: 0.7; }
    .layer-violation-badge {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 18px; height: 18px; border-radius: 9px;
      background: #f59e0b; color: #fff; font-size: 0.58rem;
      font-weight: 700; padding: 0 5px; letter-spacing: 0; text-transform: none;
    }

    /* Stats bar floating at top of graph */
    #layerStatsBar {
      position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
      z-index: 10; display: flex; align-items: center; gap: 8px;
      padding: 6px 18px; border-radius: 20px;
      background: var(--surface); border: 1px solid var(--border);
      font-size: 0.74rem; font-weight: 500; color: var(--text);
      box-shadow: 0 2px 10px rgba(0,0,0,0.15); pointer-events: none;
    }
    .layer-stat { white-space: nowrap; }
    .layer-stat-sep { opacity: 0.3; font-size: 0.8em; }
    .layer-stat-warn { color: #f59e0b; font-weight: 600; }

    /* Sidebar violation groups */
    .panel-section-header {
      font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.04em; color: var(--text-dim);
      padding: 0.5rem 0 0.25rem; display: flex; align-items: center; gap: 0.4rem;
    }
    .count-badge {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 20px; height: 18px; border-radius: 9px;
      font-size: 0.62rem; font-weight: 700; padding: 0 5px;
      background: rgba(255,255,255,0.08); color: var(--text);
    }
    .count-badge-warn { background: rgba(245,158,11,0.15); color: #f59e0b; }
    .layers-violation-group { margin-bottom: 2px; }
    .layers-violation-src {
      display: flex; align-items: center; gap: 0.35rem;
      padding: 0.4rem 0.4rem; font-size: 0.72rem; font-weight: 600;
      color: #f59e0b; border-radius: 4px; cursor: pointer;
      transition: background 0.12s;
    }
    .layers-violation-src:hover { background: rgba(245,158,11,0.1); }
    .layers-violation-src svg { flex-shrink: 0; opacity: 0.7; }
    .layers-violation-edge {
      padding: 0.25rem 0.4rem 0.25rem 1.6rem;
      font-size: 0.68rem; color: var(--text-dim); cursor: pointer;
      border-radius: 4px; transition: background 0.12s;
    }
    .layers-violation-edge:hover { background: rgba(255,255,255,0.05); color: var(--text); }
    .metric-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.25rem 0.4rem; font-size: 0.72rem;
    }
    .metric-row.clickable { cursor: pointer; border-radius: 4px; }
    .metric-row.clickable:hover { background: rgba(255,255,255,0.05); }
    .metric-label { color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .metric-label strong { color: var(--text); }
    .metric-value { color: var(--text); font-weight: 600; flex-shrink: 0; }
    .badge { padding: 1px 6px; border-radius: 8px; font-size: 0.6rem; font-weight: 700; }
    .badge-warn { background: rgba(245,158,11,0.15); color: #f59e0b; }

    /* Layer override bar in sidebar */
    .layer-overrides-bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.4rem 0.6rem; margin: 0.4rem 0;
      background: rgba(99,102,241,0.1); border-radius: 6px;
      font-size: 0.7rem; color: var(--text);
    }
    .layer-overrides-bar button {
      padding: 0.2rem 0.5rem; border: 1px solid var(--border);
      border-radius: 4px; background: var(--surface);
      color: var(--text-dim); font-size: 0.65rem; cursor: pointer;
    }
    .layer-overrides-bar button:hover {
      background: rgba(239,68,68,0.1); color: #ef4444;
    }

    /* ===== Tree View Styles ===== */
    #treeContainer {
      display: none;
      flex-direction: column;
      width: 100%;
      height: calc(100vh - 48px);
      overflow: hidden;
      position: relative;
      background-image: radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px);
      background-size: 28px 28px;
    }
    #treeContainer.active { display: flex; }
    .tree-grabbing { cursor: grabbing !important; user-select: none; }
    .tree-zoom-layer {
      display: inline-flex;
      justify-content: center;
      transform-origin: center top;
      /* No CSS transition — avoids stutter on render and scroll-zoom lag */
      min-width: calc(100% + 1400px);
      min-height: calc(100% + 1200px);
      padding: 160px 700px 600px;
    }
    .tree-branch { display: flex; flex-direction: column; align-items: center; }
    .tree-node {
      display: flex; align-items: center; gap: 8px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; padding: 8px 14px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
      cursor: pointer; white-space: nowrap;
      transition: box-shadow 0.15s, border-color 0.15s;
      font-size: 13px;
    }
    .tree-node:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      border-color: var(--primary);
    }
    .tree-node-root {
      border-color: var(--primary);
      background: linear-gradient(135deg, var(--surface), rgba(99,102,241,0.1));
      box-shadow: 0 2px 8px rgba(99,102,241,0.2);
      padding: 10px 16px;
    }
    .tree-node-root .tree-node-name { font-size: 14px; }
    .tree-node-left { display: flex; align-items: center; gap: 8px; }
    .tree-node-right { display: flex; align-items: center; gap: 6px; margin-left: 8px; }
    .tree-file-type-badge {
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 9px; font-weight: 700; color: #fff;
      min-width: 24px; height: 18px; padding: 0 4px;
      border-radius: 4px; letter-spacing: 0.03em;
    }
    .tree-node-dot {
      width: 9px; height: 9px; border-radius: 50%;
      flex-shrink: 0;
    }
    .tree-node-name {
      font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
      font-size: 13px;
      max-width: 240px; overflow: hidden; text-overflow: ellipsis;
    }
    .tree-node:hover .tree-node-name { max-width: 500px; }
    .tree-focus-btn {
      opacity: 0; width: 24px; height: 24px; border: none;
      background: transparent; border-radius: 4px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; color: var(--text);
      transition: opacity 0.15s;
    }
    .tree-node:hover .tree-focus-btn { opacity: 0.5; }
    .tree-focus-btn:hover { opacity: 1 !important; background: var(--border); }
    .tree-risk-summary { display: inline-flex; gap: 3px; align-items: center; }
    .tree-risk-summary-dot { width: 7px; height: 7px; border-radius: 50%; }
    .tree-risk-summary-more { font-size: 9px; opacity: 0.5; margin-left: 2px; }

    /* Connectors */
    .tree-stem { width: 2px; height: 36px; background: var(--primary); opacity: 0.3; }
    .tree-children-row { display: flex; flex-direction: row; gap: 28px; align-items: flex-start; }
    .tree-children-row-multi { position: relative; }
    .tree-hbar { position: absolute; top: 0; height: 2px; background: var(--primary); opacity: 0.3; }
    .tree-child-col { display: flex; flex-direction: column; align-items: center; }
    .tree-drop { display: flex; flex-direction: column; align-items: center; }
    .tree-drop::before {
      content: ''; display: block;
      width: 2px; height: 28px;
      background: var(--primary); opacity: 0.3;
    }
    .tree-drop::after {
      content: ''; display: block;
      width: 0; height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-top: 8px solid var(--primary);
      opacity: 0.5; margin-bottom: 3px;
    }

    /* Zoom controls */
    .tree-zoom-controls {
      position: absolute; bottom: 16px; right: 16px;
      display: flex; align-items: center; gap: 2px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; padding: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 20; user-select: none;
    }
    .tree-zoom-btn {
      width: 28px; height: 28px; border: none; background: transparent;
      border-radius: 6px; font-size: 15px; font-weight: 600;
      color: var(--text); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
    }
    .tree-zoom-btn:hover { background: var(--border); }
    .tree-zoom-level {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 11px; opacity: 0.6;
      min-width: 38px; text-align: center;
    }
    .tree-zoom-reset { font-size: 14px; margin-left: 2px; }

    /* Tree empty state */
    .tree-empty {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 12px;
      padding: 60px 20px; text-align: center;
      color: var(--text); opacity: 0.6;
    }
    .tree-empty-title { font-size: 16px; font-weight: 600; }
    .tree-empty-desc { font-size: 12px; max-width: 300px; }
    .tree-picker-search {
      width: 280px; max-width: 90%; margin: 0 auto 10px; display: block;
      font-family: 'SF Mono', Consolas, monospace; font-size: 11px;
      padding: 6px 10px 6px 28px; border-radius: 99px;
      background: var(--surface); border: 1px solid var(--border);
      color: var(--text); outline: none;
    }
    .tree-picker-search:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(99,102,241,0.15); }
    .tree-picker-search-wrap { position: relative; text-align: center; }
    .tree-picker-search-icon {
      position: absolute; left: calc(50% - 140px + 8px); top: 50%;
      transform: translateY(-50%); color: var(--text-dim); pointer-events: none;
    }
    .tree-file-picker {
      display: flex; flex-direction: column; gap: 0;
      padding: 0 20px 20px; max-width: 400px; margin: 0 auto;
      max-height: 50vh; overflow-y: auto;
    }
    .tree-picker-folder-group {
      border: 1px solid var(--border); border-radius: 4px; margin-bottom: 3px; overflow: hidden;
    }
    .tree-picker-folder-group.open { border-color: var(--accent); }
    .tree-picker-folder-header {
      display: flex; align-items: center; gap: 6px;
      padding: 5px 8px; cursor: pointer; font-size: 11px;
      color: var(--text-dim); background: var(--surface); user-select: none;
    }
    .tree-picker-folder-header:hover { background: rgba(255,255,255,0.04); }
    .tree-picker-folder-arrow { font-size: 8px; width: 10px; text-align: center; color: var(--text-dim); }
    .tree-picker-folder-name { font-family: 'SF Mono', Consolas, monospace; font-size: 11px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tree-picker-folder-count { font-size: 10px; background: rgba(255,255,255,0.06); padding: 1px 6px; border-radius: 99px; }
    .tree-picker-folder-files { border-top: 1px solid var(--border); }
    .tree-file-picker-item {
      display: flex; align-items: center; gap: 6px;
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 11px; padding: 4px 10px 4px 24px;
      border-bottom: 1px solid var(--border);
      cursor: pointer; transition: background 0.1s;
    }
    .tree-file-picker-item:last-child { border-bottom: none; }
    .tree-file-picker-item:hover { background: rgba(99,102,241,0.1); }
    .tree-picker-item-badge {
      font-size: 9px; font-weight: 600; padding: 1px 4px;
      border-radius: 3px; color: #fff; min-width: 16px; text-align: center;
    }
    .tree-picker-item-name { color: var(--text); font-weight: 500; white-space: nowrap; }
    .tree-picker-item-path { color: var(--text-dim); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: auto; }
    .tree-picker-no-match { padding: 16px; text-align: center; color: var(--text-dim); font-size: 12px; }
    .tree-picker-results .tree-file-picker-item { padding-left: 10px; border-radius: 4px; border-bottom: none; margin-bottom: 1px; }

    /* Tree toolbar section */
    .tree-toolbar-section { display: none; align-items: center; gap: 6px; }
    .tree-toolbar-section.active { display: flex; }
    .tree-dir-btn {
      font-size: 11px; padding: 2px 8px;
      background: none; border: 1px solid var(--border);
      color: var(--text); border-radius: 4px; cursor: pointer;
    }
    .tree-dir-btn:hover { background: var(--border); }
    .tree-dir-btn.active { background: var(--primary); border-color: var(--primary); color: #fff; }
    .tree-root-chip {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 10px; padding: 2px 8px;
      background: rgba(99,102,241,0.15); color: var(--primary);
      border-radius: 4px;
    }
    .tree-back-btn {
      display: flex; align-items: center; gap: 4px;
      background: none; border: 1px solid var(--border);
      color: var(--text); border-radius: 4px;
      cursor: pointer; padding: 2px 8px;
      font-size: 11px;
    }
    .tree-back-btn:hover { background: var(--border); }
    .tree-back-btn svg { opacity: 0.6; }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="view-toggle">
      <button id="btnViewGraph" class="active">Graph</button>
      <button id="btnViewTree">Tree</button>
      <button id="btnViewLayers">Layers</button>
    </div>
    <input class="search-input" id="search" type="text" placeholder="Search files... (/)">
    <!-- Graph-only toolbar items -->
    <span id="graphToolbar" style="display:contents;">
      <button id="btnForce" class="active">Force</button>
      <button id="btnHierarchy">Hierarchy</button>
      <button id="btnConcentric">Concentric</button>
      <div class="color-toggle">
        <button id="btnRisk" class="active">Risk</button>
        <button id="btnDir">Directory</button>
        <button id="btnChurn">Churn</button>
      </div>
    </span>
    <!-- Tree-only toolbar items -->
    <div class="tree-toolbar-section" id="treeToolbar">
      <button class="tree-dir-btn active" id="btnTreeDown">What breaks?</button>
      <button class="tree-dir-btn" id="btnTreeUp">Depends on</button>
      <button class="tree-back-btn" id="treeBackBtn" style="display:none;" title="Change root file">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        <span class="tree-root-chip" id="treeRootChip" style="display:none;"></span>
      </button>
    </div>
    <div class="spacer"></div>
    <div class="cycle-badge" id="cycleBadge">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
      <span id="cycleCount"></span>
    </div>
    <div class="stats" id="stats"></div>
  </div>
  <div class="legend" id="legend">
    <span><span class="legend-dot" style="background:#ef4444;"></span>Critical</span>
    <span><span class="legend-dot" style="background:#f97316;"></span>High</span>
    <span><span class="legend-dot" style="background:#eab308;"></span>Warning</span>
    <span><span class="legend-dot" style="background:#3b82f6;"></span>Normal</span>
    <span><span class="legend-dot" style="background:#22c55e;"></span>Entry</span>
    <span><span class="legend-dot" style="background:#6b7280;"></span>System</span>
  </div>
  <div id="cy"></div>
  <div id="treeContainer"></div>
  <div class="layers-panel" id="layersPanel" style="display:none;">
    <div class="layers-panel-header">Architecture Layers</div>
    <div class="layers-panel-body">
      <div class="layers-input-row">
        <input type="text" id="layerInput" placeholder="ui, service, data, util" spellcheck="false">
        <button id="btnApplyLayers">Apply</button>
      </div>
      <div class="layers-hint">Define layers top-to-bottom, or leave empty for auto-depth.</div>
      <div id="layersInfo"></div>
    </div>
  </div>
  <div class="loading" id="loading">
    <img src="${logoUri}" alt="Loading…" class="loading-logo">
    <div>Analyzing dependencies...</div>
  </div>
  <div class="tooltip" id="tooltip"></div>
  <div class="context-menu" id="contextMenu">
    <button id="ctxOpen">Open File</button>
    <button id="ctxDependents">Show Dependents</button>
    <button id="ctxDependencies">Show Dependencies</button>
    <button id="ctxBlast">Blast Radius</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let cy;
    let graphData = null;
    let currentLayout = 'cose';
    let contextNodeId = null;
    let colorMode = 'risk'; // 'risk', 'directory', or 'churn'
    let churnData = null;
    let layersActive = false;
    let userLayers = null;
    let layerLabels = [];
    let savedPositions = null; // stash graph positions before layers rearranges them
    let baseStyles = []; // saved from renderGraph so layers can rebuild the full stylesheet

    const RISK_COLORS = ${JSON.stringify(_sharedConstants.risk_colors)};

    function lerpColor(a, b, t) {
      var pa = [parseInt(a.slice(1,3),16), parseInt(a.slice(3,5),16), parseInt(a.slice(5,7),16)];
      var pb = [parseInt(b.slice(1,3),16), parseInt(b.slice(3,5),16), parseInt(b.slice(5,7),16)];
      var r = Math.round(pa[0] + (pb[0]-pa[0]) * t);
      var g = Math.round(pa[1] + (pb[1]-pa[1]) * t);
      var bl = Math.round(pa[2] + (pb[2]-pa[2]) * t);
      return '#' + [r,g,bl].map(function(c) { return c.toString(16).padStart(2,'0'); }).join('');
    }

    function churnColor(score) {
      if (score <= 0.5) return lerpColor('#3b82f6', '#eab308', score / 0.5);
      return lerpColor('#eab308', '#ef4444', (score - 0.5) / 0.5);
    }

    function applyColorMode() {
      if (!cy || !graphData) return;
      cy.batch(function() {
        cy.nodes().forEach(function(n) {
          if (colorMode === 'risk') {
            var rc = n.data('risk_color') || RISK_COLORS[n.data('risk')] || RISK_COLORS.normal;
            n.data('color', rc);
          } else if (colorMode === 'churn') {
            if (churnData && churnData.files) {
              var info = churnData.files[n.data('id')];
              if (info) {
                n.data('color', churnColor(info.churn_score));
              } else {
                n.data('color', '#6b7280');
              }
            } else {
              n.data('color', '#6b7280');
            }
          } else {
            n.data('color', n.data('dir_color') || n.data('color'));
          }
        });
      });
      // Update legend content
      var legendEl = document.getElementById('legend');
      if (colorMode === 'risk') {
        legendEl.innerHTML =
          '<span><span class="legend-dot" style="background:#ef4444;"></span>Critical</span>' +
          '<span><span class="legend-dot" style="background:#f97316;"></span>High</span>' +
          '<span><span class="legend-dot" style="background:#eab308;"></span>Warning</span>' +
          '<span><span class="legend-dot" style="background:#3b82f6;"></span>Normal</span>' +
          '<span><span class="legend-dot" style="background:#22c55e;"></span>Entry</span>' +
          '<span><span class="legend-dot" style="background:#6b7280;"></span>System</span>';
      } else if (colorMode === 'churn') {
        var html = '<div style="display:flex;flex-direction:column;width:100%;gap:2px;">';
        html += '<div style="height:10px;border-radius:5px;background:linear-gradient(to right,#3b82f6,#eab308,#ef4444);"></div>';
        html += '<div style="display:flex;justify-content:space-between;font-size:0.65rem;opacity:0.7;"><span>Low</span><span>High</span></div>';
        html += '</div>';
        legendEl.innerHTML = html;
      } else if (graphData) {
        var dirMap = {};
        graphData.nodes.forEach(function(n) {
          var id = n.data.id;
          var color = n.data.dir_color || n.data.color || '#6b7280';
          var dir = id.includes('/') ? id.substring(0, id.lastIndexOf('/')) : '.';
          if (!dirMap[dir]) dirMap[dir] = color;
        });
        legendEl.innerHTML = Object.keys(dirMap).sort().map(function(d) {
          return '<span><span class="legend-dot" style="background:' + dirMap[d] + ';"></span>' + d + '</span>';
        }).join('');
      }
      legendEl.style.display = 'flex';
    }

    // Register cytoscape-dagre plugin for Hierarchy layout
    const hasDagre = typeof dagre !== 'undefined';
    const hasCytoscapeDagre = typeof cytoscapeDagre === 'function';
    console.log('[DepGraph] Libraries:', {
      cytoscape: typeof cytoscape !== 'undefined',
      dagre: hasDagre,
      cytoscapeDagre: hasCytoscapeDagre
    });
    if (hasCytoscapeDagre) {
      try { cytoscape.use(cytoscapeDagre); } catch(_) {}
    }

    // ── Message handling ──────────────────────────────────────────
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'graphData':
          graphData = msg.data;
          renderGraph(msg.data);
          break;
        case 'error':
          document.getElementById('loading').innerHTML =
            '<div style="color:var(--danger);">' + msg.message + '</div>';
          break;
        case 'focusNode':
          if (cy) {
            const node = cy.getElementById(msg.nodeId);
            if (node.length) {
              cy.animate({ center: { eles: node }, zoom: 2 }, { duration: 400 });
              node.flashClass('highlighted', 1500);
            }
          }
          break;
        case 'highlightNodes':
          if (cy) {
            cy.elements().removeClass('dimmed highlighted');
            if (msg.nodeIds && msg.nodeIds.length > 0) {
              cy.elements().addClass('dimmed');
              msg.nodeIds.forEach(id => {
                const n = cy.getElementById(id);
                n.removeClass('dimmed').addClass('highlighted');
                n.connectedEdges().removeClass('dimmed');
              });
            }
          }
          break;
        case 'blastRadiusResult':
          if (cy) {
            cy.elements().removeClass('dimmed highlighted');
            cy.elements().addClass('dimmed');
            const origin = cy.getElementById(msg.nodeId);
            origin.removeClass('dimmed').addClass('highlighted');
            msg.affected.forEach(id => {
              cy.getElementById(id).removeClass('dimmed').addClass('highlighted');
            });
          }
          break;
        case 'churnData':
          churnData = msg.data;
          if (colorMode === 'churn') applyColorMode();
          break;
      }
    });

    // ── Graph rendering ───────────────────────────────────────────
    function renderGraph(data) {
      document.getElementById('loading').style.display = 'none';
      const nodes = data.nodes.map(n => {
        const d = { ...n.data };
        if (!d.dir_color) d.dir_color = d.color; // fallback directory color
        if (colorMode === 'risk') {
          d.color = d.risk_color || RISK_COLORS[d.risk] || RISK_COLORS.normal;
        }
        return { ...n, data: d };
      });
      const edges = data.edges.map(e => ({ ...e }));

      if (cy) { cy.destroy(); }

      // Save base styles so layers view can rebuild the full stylesheet
      baseStyles = [
        {
          selector: 'node',
          style: {
            'width': 'data(size)',
            'height': 'data(size)',
            'background-color': 'data(color)',
            'label': 'data(id)',
            'color': '#eee',
            'text-outline-color': 'data(color)',
            'text-outline-width': 2,
            'font-size': '11px',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'ellipsis',
            'text-max-width': '120px',
          },
        },
        {
          selector: 'edge',
          style: {
            'width': (ele) => { const w = ele.data('weight') || 1; return 2 + w * 1.2; },
            'line-color': (ele) => {
              const w = ele.data('weight') || 1;
              const t = (w - 1) / 4;
              const r = Math.round(148 - t * 50);
              const g = Math.round(163 - t * 55);
              const b = Math.round(184 - t * 30);
              return 'rgb(' + r + ',' + g + ',' + b + ')';
            },
            'target-arrow-color': (ele) => {
              const w = ele.data('weight') || 1;
              const t = (w - 1) / 4;
              const r = Math.round(148 - t * 50);
              const g = Math.round(163 - t * 55);
              const b = Math.round(184 - t * 30);
              return 'rgb(' + r + ',' + g + ',' + b + ')';
            },
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'opacity': (ele) => { const w = ele.data('weight') || 1; return 0.4 + (w - 1) * 0.15; },
          },
        },
        {
          selector: 'edge.cycle',
          style: {
            'line-color': '#ef4444',
            'target-arrow-color': '#ef4444',
            'line-style': 'dashed',
            'width': 3,
            'opacity': 1,
          },
        },
        {
          selector: '.dimmed',
          style: { 'opacity': 0.15 },
        },
        {
          selector: '.highlighted',
          style: {
            'opacity': 1,
            'border-width': 3,
            'border-color': '#6366f1',
          },
        },
      ];

      cy = cytoscape({
        container: document.getElementById('cy'),
        elements: [...nodes, ...edges],
        style: baseStyles,
        layout: getLayoutConfig(currentLayout),
        minZoom: 0.08,
        maxZoom: 4,
        wheelSensitivity: 0.25,
      });

      // Stats
      document.getElementById('stats').textContent =
        nodes.length + ' files · ' + edges.length + ' edges';

      // Cycle badge
      const badge = document.getElementById('cycleBadge');
      if (data.has_cycles && data.cycles.length > 0) {
        badge.classList.add('visible');
        document.getElementById('cycleCount').textContent =
          data.cycles.length + ' cycle' + (data.cycles.length > 1 ? 's' : '');
      } else {
        badge.classList.remove('visible');
      }

      // ── Hover tooltip ──────────────────────────────────────────
      const tooltip = document.getElementById('tooltip');
      cy.on('mouseover', 'node', (e) => {
        const d = e.target.data();
        const riskLabel = d.risk_label || d.risk || 'normal';
        const riskColor = RISK_COLORS[d.risk] || RISK_COLORS.normal;
        tooltip.innerHTML =
          '<div class="tooltip-title">' + d.id + '</div>' +
          '<div class="tooltip-row"><span class="tooltip-label">Risk</span><span style="color:' + riskColor + ';font-weight:600;">' + riskLabel + '</span></div>' +
          '<div class="tooltip-row"><span class="tooltip-label">Inbound</span><span>' + (d.in_degree || 0) + '</span></div>' +
          '<div class="tooltip-row"><span class="tooltip-label">Outbound</span><span>' + (d.out_degree || 0) + '</span></div>' +
          '<div class="tooltip-row"><span class="tooltip-label">Depth</span><span>' + d.depth + '</span></div>' +
          '<div class="tooltip-row"><span class="tooltip-label">Impact</span><span>' + d.impact + '</span></div>' +
          '<div class="tooltip-row"><span class="tooltip-label">Stability</span><span>' + (d.stability || 0).toFixed(2) + '</span></div>' +
          '<div class="tooltip-row"><span class="tooltip-label">Reach</span><span>' + (d.reach_pct || 0).toFixed(1) + '%</span></div>' +
          '<div class="tooltip-row"><span class="tooltip-label">Language</span><span>' + (d.language || '?') + '</span></div>';
        tooltip.classList.add('visible');
      });
      cy.on('mousemove', 'node', (e) => {
        const pos = e.renderedPosition || e.position;
        tooltip.style.left = (pos.x + 15) + 'px';
        tooltip.style.top = (pos.y + 15) + 'px';
      });
      cy.on('mouseout', 'node', () => {
        tooltip.classList.remove('visible');
      });

      // ── Double-click to open ───────────────────────────────────
      cy.on('dbltap', 'node', (e) => {
        vscode.postMessage({ type: 'openFile', fileId: e.target.id() });
      });

      // ── Right-click context menu ───────────────────────────────
      cy.on('cxttap', 'node', (e) => {
        e.originalEvent.preventDefault();
        contextNodeId = e.target.id();
        const menu = document.getElementById('contextMenu');
        const pos = e.renderedPosition || e.position;
        menu.style.left = pos.x + 'px';
        menu.style.top = (pos.y + 48) + 'px'; // offset for toolbar
        menu.classList.add('visible');
      });
      document.addEventListener('click', () => {
        document.getElementById('contextMenu').classList.remove('visible');
      });

      // ── Click to clear highlights ──────────────────────────────
      cy.on('tap', (e) => {
        if (e.target === cy) {
          cy.elements().removeClass('dimmed highlighted');
        }
      });

      // Layer labels now use RAF-based renderedBoundingBox() sync — no viewport listener needed.
    }

    /** Run dagre manually: compute positions with dagre lib, apply as preset layout */
    function runManualDagre() {
      if (typeof dagre === 'undefined' || !cy) return false;
      try {
        const g = new dagre.graphlib.Graph();
        g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 });
        g.setDefaultEdgeLabel(() => ({}));
        cy.nodes().forEach(n => {
          g.setNode(n.id(), { width: n.width() || 40, height: n.height() || 40 });
        });
        cy.edges().forEach(e => {
          g.setEdge(e.source().id(), e.target().id());
        });
        dagre.layout(g);
        cy.nodes().forEach(n => {
          const pos = g.node(n.id());
          if (pos) n.position({ x: pos.x, y: pos.y });
        });
        cy.fit(120);
        return true;
      } catch (err) {
        console.error('[DepGraph] Manual dagre failed:', err);
        return false;
      }
    }

    function getLayoutConfig(name) {
      switch (name) {
        case 'dagre':
          return { name: 'dagre', rankDir: 'TB', nodeSep: 60, rankSep: 80, animate: true, animationDuration: 300 };
        case 'concentric':
          return {
            name: 'concentric',
            concentric: (n) => n.data('impact') || 1,
            levelWidth: () => 2,
            animate: true,
            animationDuration: 300,
          };
        default: {
          const nc = cy ? cy.nodes().length : 10;
          const ec = cy ? cy.edges().length : 0;
          const dens = nc > 1 ? ec / (nc * (nc - 1)) : 0;
          const dense = dens > 0.05;
          const rep = nc < 20 ? (dense ? 8000 : 5000) : (dense ? 18000 : 10000);
          const elen = nc < 20 ? 70 : (dense ? 120 : 100);
          const grav = nc < 20 ? (dense ? 100 : 150) : (dense ? 60 : 80);
          return {
            name: 'cose', animate: true, animationDuration: 300,
            nodeRepulsion: () => rep,
            idealEdgeLength: (ele) => { const w = ele.data('weight') || 1; return elen * (1.15 - w * 0.06); },
            gravity: grav,
          };
        }
      }
    }

    // ── Layout switching ──────────────────────────────────────────
    function setLayout(name) {
      currentLayout = name;
      document.querySelectorAll('.toolbar button').forEach(b => b.classList.remove('active'));
      if (name === 'cose') document.getElementById('btnForce').classList.add('active');
      if (name === 'dagre') document.getElementById('btnHierarchy').classList.add('active');
      if (name === 'concentric') document.getElementById('btnConcentric').classList.add('active');
      if (!cy) return;
      try {
        cy.layout(getLayoutConfig(name)).run();
      } catch (err) {
        console.error('[DepGraph] Layout "' + name + '" failed:', err);
        // For dagre, try manual fallback using dagre lib directly
        if (name === 'dagre') {
          if (runManualDagre()) return;
        }
        // Fall back to cose if the requested layout isn't available
        if (name !== 'cose') {
          document.getElementById('stats').textContent += ' (layout "' + name + '" unavailable, using Force)';
          currentLayout = 'cose';
          document.querySelectorAll('.toolbar button').forEach(b => b.classList.remove('active'));
          document.getElementById('btnForce').classList.add('active');
          try { cy.layout(getLayoutConfig('cose')).run(); } catch(_) {}
        }
      }
    }

    // ── Search ────────────────────────────────────────────────────
    document.getElementById('search').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      if (!cy) return;
      if (!q) {
        cy.elements().removeClass('dimmed highlighted');
        return;
      }
      cy.elements().addClass('dimmed');
      cy.nodes().forEach(n => {
        if (n.id().toLowerCase().includes(q)) {
          n.removeClass('dimmed').addClass('highlighted');
          n.connectedEdges().removeClass('dimmed');
        }
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        document.getElementById('search').focus();
      }
      if (e.key === 'Escape') {
        document.getElementById('search').value = '';
        document.getElementById('search').blur();
        if (cy) cy.elements().removeClass('dimmed highlighted');
        document.getElementById('contextMenu').classList.remove('visible');
      }
    });

    // ── Wire up button event listeners (no inline onclick — CSP blocks them) ──
    document.getElementById('btnForce').addEventListener('click', () => setLayout('cose'));
    document.getElementById('btnHierarchy').addEventListener('click', () => setLayout('dagre'));
    document.getElementById('btnConcentric').addEventListener('click', () => setLayout('concentric'));

    // Color mode toggle
    document.getElementById('btnRisk').addEventListener('click', () => {
      colorMode = 'risk';
      document.getElementById('btnRisk').classList.add('active');
      document.getElementById('btnDir').classList.remove('active');
      document.getElementById('btnChurn').classList.remove('active');
      applyColorMode();
    });
    document.getElementById('btnDir').addEventListener('click', () => {
      colorMode = 'directory';
      document.getElementById('btnDir').classList.add('active');
      document.getElementById('btnRisk').classList.remove('active');
      document.getElementById('btnChurn').classList.remove('active');
      applyColorMode();
    });
    document.getElementById('btnChurn').addEventListener('click', () => {
      colorMode = 'churn';
      document.getElementById('btnChurn').classList.add('active');
      document.getElementById('btnRisk').classList.remove('active');
      document.getElementById('btnDir').classList.remove('active');
      if (!churnData) vscode.postMessage({ type: 'requestChurn' });
      applyColorMode();
    });

    document.getElementById('ctxOpen').addEventListener('click', () => {
      if (contextNodeId) vscode.postMessage({ type: 'openFile', fileId: contextNodeId });
    });
    document.getElementById('ctxDependents').addEventListener('click', () => {
      if (contextNodeId) vscode.postMessage({ type: 'requestDependents', nodeId: contextNodeId });
    });
    document.getElementById('ctxDependencies').addEventListener('click', () => {
      if (contextNodeId) vscode.postMessage({ type: 'requestDependencies', nodeId: contextNodeId });
    });
    document.getElementById('ctxBlast').addEventListener('click', () => {
      if (contextNodeId) vscode.postMessage({ type: 'requestBlastRadius', nodeId: contextNodeId });
    });

    // ══════════════════════════════════════════════════════════════
    // ═══ TREE VIEW ═══════════════════════════════════════════════
    // ══════════════════════════════════════════════════════════════

    let currentView = 'graph'; // 'graph' or 'tree'
    let treeRootNode = null;
    let treeDirection = 'downstream';
    let treePendingRaf = null;

    const FILE_TYPE_ICONS = {
      ts: {label:'TS',bg:'#3178c6'}, tsx: {label:'TX',bg:'#3178c6'},
      js: {label:'JS',bg:'#f7df1e',color:'#222'}, jsx: {label:'JX',bg:'#f7df1e',color:'#222'},
      mjs: {label:'MJ',bg:'#f7df1e',color:'#222'}, cjs: {label:'CJ',bg:'#f7df1e',color:'#222'},
      py: {label:'PY',bg:'#3776ab'}, java: {label:'JA',bg:'#b07219'},
      go: {label:'GO',bg:'#00add8'}, rs: {label:'RS',bg:'#dea584'},
      c: {label:'C',bg:'#555'}, h: {label:'H',bg:'#555'},
      cpp: {label:'C+',bg:'#f34b7d'}, cc: {label:'C+',bg:'#f34b7d'},
      cs: {label:'C#',bg:'#68217a'}, swift: {label:'SW',bg:'#f05138'},
      rb: {label:'RB',bg:'#cc342d'}, kt: {label:'KT',bg:'#A97BFF'},
      scala: {label:'SC',bg:'#c22d40'}, php: {label:'PH',bg:'#4f5d95'},
      dart: {label:'DA',bg:'#0175c2'}, ex: {label:'EX',bg:'#6e4a7e'},
    };

    function getFileExt(id) {
      const dot = id.lastIndexOf('.');
      return dot >= 0 ? id.substring(dot + 1).toLowerCase() : '';
    }

    function switchView(view) {
      // Deactivate layers if leaving layers view
      if (currentView === 'layers' && view !== 'layers') {
        deactivateLayers();
      }
      currentView = view;
      const cyEl = document.getElementById('cy');
      const treeEl = document.getElementById('treeContainer');
      const graphTb = document.getElementById('graphToolbar');
      const treeTb = document.getElementById('treeToolbar');
      const legendEl = document.getElementById('legend');
      const layersPanel = document.getElementById('layersPanel');

      document.getElementById('btnViewGraph').classList.toggle('active', view === 'graph');
      document.getElementById('btnViewTree').classList.toggle('active', view === 'tree');
      document.getElementById('btnViewLayers').classList.toggle('active', view === 'layers');

      if (view === 'tree') {
        cyEl.style.display = 'none';
        treeEl.classList.add('active');
        graphTb.style.display = 'none';
        treeTb.classList.add('active');
        legendEl.style.display = 'none';
        layersPanel.style.display = 'none';
        renderTree();
      } else if (view === 'layers') {
        cyEl.style.display = 'block';
        treeEl.classList.remove('active');
        graphTb.style.display = 'none';
        treeTb.classList.remove('active');
        legendEl.style.display = 'none';
        layersPanel.style.display = '';
        activateLayers();
      } else {
        cyEl.style.display = 'block';
        treeEl.classList.remove('active');
        graphTb.style.display = 'contents';
        treeTb.classList.remove('active');
        legendEl.style.display = 'flex';
        layersPanel.style.display = 'none';
      }
    }

    document.getElementById('btnViewGraph').addEventListener('click', () => switchView('graph'));
    document.getElementById('btnViewTree').addEventListener('click', () => switchView('tree'));
    document.getElementById('btnViewLayers').addEventListener('click', () => switchView('layers'));

    // ── Layers view logic ──────────────────────────────────────
    const VIOLATION_COLOR = '#f59e0b';
    const VIOLATION_GLOW  = '#fcd34d';
    let violationPulseTimer = null;
    let layerParentIds = [];
    let labelRafId = null;
    let layerOverrides = {};  // fileId → rank (per-file layer reassignments)
    let dragStartRank = null;
    let draggedNode = null;
    let dragStartPos = null;
    let dragBandSnapshot = null;

    function dirOf(fp) {
      const i = fp.lastIndexOf('/');
      return i >= 0 ? fp.substring(0, i) : '.';
    }

    function escHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function effectiveRank(nodeId) {
      // 1. Per-file override (from drag simulation)
      if (layerOverrides[nodeId] !== undefined) return layerOverrides[nodeId];
      // 2. User-defined layer names
      if (userLayers && userLayers.length > 0) {
        const parts = nodeId.replace(/\\\\/g, '/').split('/');
        for (const part of parts) {
          const idx = userLayers.indexOf(part.toLowerCase());
          if (idx !== -1) return idx;
        }
        return userLayers.length; // unmatched → bottom
      }
      // 3. Auto depth
      const n = cy.getElementById(nodeId);
      return n.length ? (n.data('depth') || 0) : 0;
    }

    function rankName(rank) {
      if (userLayers && userLayers.length > 0) {
        return rank < userLayers.length ? userLayers[rank] : 'other';
      }
      return 'L' + rank;
    }

    function computeLayerPositions() {
      const nodes = cy.nodes().filter(n => !n.data('isLayerBand'));
      if (nodes.length === 0) return {};
      const nodeCount = nodes.length;

      let nodeGap, groupGap, rowHeight, maxPerRow;
      if (nodeCount <= 30)       { nodeGap=120; groupGap=90; rowHeight=220; maxPerRow=999; }
      else if (nodeCount <= 80)  { nodeGap=85;  groupGap=65; rowHeight=185; maxPerRow=16;  }
      else if (nodeCount <= 200) { nodeGap=60;  groupGap=45; rowHeight=150; maxPerRow=22;  }
      else                       { nodeGap=40;  groupGap=28; rowHeight=110; maxPerRow=30;  }

      const depthBuckets = {};
      let maxDepth = 0;
      nodes.forEach(n => {
        const d = effectiveRank(n.id());
        if (d > maxDepth) maxDepth = d;
        if (!depthBuckets[d]) depthBuckets[d] = [];
        depthBuckets[d].push(n);
      });

      // Sort by directory then alpha
      for (let d = 0; d <= maxDepth; d++) {
        (depthBuckets[d] || []).sort((a,b) => {
          const da = dirOf(a.id()), db = dirOf(b.id());
          if (da !== db) return da.localeCompare(db);
          return a.id().localeCompare(b.id());
        });
      }

      // Barycenter ordering
      const adjBelow = {}, adjAbove = {};
      cy.edges().forEach(e => {
        const sId = e.source().id(), tId = e.target().id();
        const sD = effectiveRank(sId), tD = effectiveRank(tId);
        if (tD === sD + 1) {
          (adjBelow[sId] = adjBelow[sId] || []).push(tId);
          (adjAbove[tId] = adjAbove[tId] || []).push(sId);
        } else if (sD === tD + 1) {
          (adjBelow[tId] = adjBelow[tId] || []).push(sId);
          (adjAbove[sId] = adjAbove[sId] || []).push(tId);
        }
      });
      const orderIndex = {};
      for (let d = 0; d <= maxDepth; d++)
        (depthBuckets[d] || []).forEach((n,i) => { orderIndex[n.id()] = i; });

      function bc(nodeId, adj) {
        const nb = adj[nodeId];
        if (!nb || !nb.length) return -1;
        return nb.reduce((s,id) => s + (orderIndex[id]||0), 0) / nb.length;
      }
      function bcSort(bucket, adj) {
        if (bucket.length <= 1) return;
        bucket.sort((a,b) => {
          const bca = bc(a.id(), adj), bcb = bc(b.id(), adj);
          if (bca === -1 && bcb === -1) return dirOf(a.id()).localeCompare(dirOf(b.id())) || a.id().localeCompare(b.id());
          if (bca === -1) return 1;
          if (bcb === -1) return -1;
          return bca - bcb;
        });
      }
      for (let pass = 0; pass < Math.min(4, maxDepth+1); pass++) {
        for (let d = 1; d <= maxDepth; d++) { bcSort(depthBuckets[d]||[], adjAbove); (depthBuckets[d]||[]).forEach((n,i) => { orderIndex[n.id()]=i; }); }
        for (let d = maxDepth-1; d >= 0; d--) { bcSort(depthBuckets[d]||[], adjBelow); (depthBuckets[d]||[]).forEach((n,i) => { orderIndex[n.id()]=i; }); }
      }

      // Assign positions
      const positions = {};
      let yOffset = 100;
      for (let d = 0; d <= maxDepth; d++) {
        const bucket = depthBuckets[d] || [];
        if (!bucket.length) { yOffset += rowHeight; continue; }
        const rows = [];
        for (let i = 0; i < bucket.length; i += maxPerRow) rows.push(bucket.slice(i, i + maxPerRow));
        rows.forEach((row, ri) => {
          const y = yOffset + ri * (rowHeight * 0.55);
          let x = 0, prevDir = null;
          row.forEach(n => {
            const dir = dirOf(n.id());
            if (prevDir !== null && dir !== prevDir) x += groupGap;
            positions[n.id()] = { x, y };
            x += nodeGap;
            prevDir = dir;
          });
          const shift = (x - nodeGap) / 2;
          row.forEach(n => { positions[n.id()].x -= shift; });
        });
        yOffset += rowHeight + (rows.length - 1) * (rowHeight * 0.55);
      }
      return positions;
    }

    // ── Mark violation edges ──
    function markViolationEdges() {
      if (!cy) return;
      cy.edges().forEach(e => {
        const srcRank = effectiveRank(e.source().id());
        const tgtRank = effectiveRank(e.target().id());
        if (srcRank > tgtRank) {
          e.addClass('violation');
          e.source().addClass('violation-endpoint');
          e.target().addClass('violation-endpoint');
        } else {
          e.removeClass('violation');
        }
      });
    }

    // ── Violation pulse animation ──
    function startViolationPulse() {
      stopViolationPulse();
      if (!cy) return;
      let bright = true;
      violationPulseTimer = setInterval(() => {
        if (!layersActive || !cy) { stopViolationPulse(); return; }
        const violations = cy.edges('.violation');
        if (violations.length === 0) return;
        violations.style({
          'line-color': bright ? VIOLATION_GLOW : VIOLATION_COLOR,
          'target-arrow-color': bright ? VIOLATION_GLOW : VIOLATION_COLOR,
        });
        bright = !bright;
      }, 900);
    }

    function stopViolationPulse() {
      if (violationPulseTimer) {
        clearInterval(violationPulseTimer);
        violationPulseTimer = null;
      }
    }

    // ── Layer styles (scale-aware) ──
    function layerStyles(nodeCount) {
      const isLarge = nodeCount > 60;
      const isHuge  = nodeCount > 150;
      const nodeSize = isHuge ? 22 : (isLarge ? 38 : 50);
      const dark = document.body.classList.contains('dark') ||
        document.documentElement.getAttribute('data-theme') === 'dark' ||
        document.body.getAttribute('data-vscode-theme-kind') === 'vscode-dark';

      return [
        { selector: 'node', style: {
          shape: 'round-rectangle', width: nodeSize, height: nodeSize,
          'font-size': isHuge ? '7px' : (isLarge ? '10px' : '12px'),
          'text-opacity': isHuge ? 0 : (isLarge ? 0.75 : 0.85),
        }},
        { selector: 'edge', style: {
          opacity: isHuge ? 0.08 : (isLarge ? 0.12 : 0.2),
          width: isHuge ? 0.8 : (isLarge ? 1.2 : 1.5),
          'arrow-scale': isHuge ? 0.4 : (isLarge ? 0.5 : 0.6),
        }},
        { selector: 'edge.violation', style: {
          'line-color': VIOLATION_COLOR, 'target-arrow-color': VIOLATION_COLOR,
          'line-style': 'dashed', 'line-dash-pattern': [10, 5],
          width: isLarge ? 1.5 : 2, opacity: 0.7,
          'arrow-scale': isLarge ? 0.6 : 0.7, 'z-index': 999,
        }},
        { selector: 'node.violation-endpoint', style: {
          'border-width': isLarge ? 2 : 2.5,
          'border-color': VIOLATION_COLOR, 'border-style': 'solid',
        }},
        { selector: 'node[?isLayerBand]', style: {
          'background-color': dark ? '#ffffff' : '#6366f1',
          'background-opacity': 0.04,
          'border-width': 1,
          'border-color': dark ? 'rgba(255,255,255,0.08)' : 'rgba(99,102,241,0.12)',
          'border-style': 'solid', 'border-opacity': 0.6,
          shape: 'round-rectangle', padding: '40px',
          label: '', 'text-opacity': 0, color: 'transparent',
          'min-width': '100px', 'min-height': '40px', 'z-index': 0,
          events: 'yes',
        }},
        { selector: 'node[?isLayerBand].layer-band-hover', style: {
          'background-opacity': dark ? 0.12 : 0.10,
          'border-width': 2, 'border-opacity': 1,
        }},
      ];
    }

    // ── Swim-lane background bands (Cytoscape compound parents) ──
    function drawLayerBands(positions) {
      clearLayerBands();
      if (!cy) return;

      const rankBuckets = {};
      cy.nodes().forEach(n => {
        if (n.data('isLayerBand')) return;
        const rank = effectiveRank(n.id());
        if (!rankBuckets[rank]) rankBuckets[rank] = [];
        rankBuckets[rank].push(n.id());
      });

      const sortedRanks = Object.keys(rankBuckets).map(Number).sort((a,b) => a - b);

      cy.batch(() => {
        sortedRanks.forEach((rank, idx) => {
          const parentId = '__layer_band_' + rank;
          layerParentIds.push(parentId);

          cy.add({
            group: 'nodes',
            data: {
              id: parentId, isLayerBand: true, layerRank: rank,
              bandColorIdx: idx % 2,
              layerNodeCount: rankBuckets[rank].length,
            },
          });

          rankBuckets[rank].forEach(nodeId => {
            cy.getElementById(nodeId).move({ parent: parentId });
          });
        });
      });

      // Prevent band parents from being grabbed
      cy.nodes('[?isLayerBand]').ungrabify().unselectify();

      // Reapply positions (reparenting can shift them)
      cy.batch(() => {
        cy.nodes().forEach(n => {
          const pos = positions[n.id()];
          if (pos) n.position(pos);
        });
      });
    }

    function clearLayerBands() {
      if (!cy) return;
      if (layerParentIds.length > 0) {
        cy.batch(() => {
          layerParentIds.forEach(pid => {
            const parent = cy.getElementById(pid);
            if (parent.length) parent.children().move({ parent: null });
          });
          cy.remove(cy.nodes().filter(n => n.data('isLayerBand')));
        });
        layerParentIds = [];
      }
      cy.nodes('.violation-endpoint').removeClass('violation-endpoint');
    }

    // ── Swim-lane labels (DOM pills synced via RAF) ──
    function drawLayerLabels(positions) {
      clearLayerLabels();
      if (!cy) return;

      const container = cy.container ? cy.container() : document.getElementById('cy');
      if (!container) return;

      // Count violations per layer
      const layerViolations = {};
      cy.edges('.violation').forEach(e => {
        const d = effectiveRank(e.source().id());
        layerViolations[d] = (layerViolations[d] || 0) + 1;
      });

      // Create one DOM pill label per band
      layerParentIds.forEach(pid => {
        const bandNode = cy.getElementById(pid);
        if (!bandNode || !bandNode.length) return;

        const rank = bandNode.data('layerRank');
        const count = bandNode.data('layerNodeCount') || 0;
        const vCount = layerViolations[rank] || 0;
        const name = rankName(rank);

        const label = document.createElement('div');
        label.className = 'layer-swim-label';
        label.dataset.bandId = pid;

        let html =
          '<span class="layer-depth-num">' + escHtml(name) + '</span>' +
          '<span class="layer-depth-count">' + count + ' file' + (count !== 1 ? 's' : '') + '</span>';
        if (vCount > 0) {
          html += '<span class="layer-violation-badge">' + vCount + '</span>';
        }
        label.innerHTML = html;
        container.appendChild(label);
        layerLabels.push(label);
      });

      // Stats bar
      const violationCount = cy.edges('.violation').length;
      const totalEdges = cy.edges().length;
      const layerCount = layerParentIds.length;
      const fileCount = cy.nodes('[!isLayerBand]').length;

      let stats = document.getElementById('layerStatsBar');
      if (!stats) {
        stats = document.createElement('div');
        stats.id = 'layerStatsBar';
        container.appendChild(stats);
      }

      const pct = totalEdges > 0 ? ((violationCount / totalEdges) * 100).toFixed(1) : '0';
      stats.innerHTML =
        '<span class="layer-stat">' + layerCount + ' layers</span>' +
        '<span class="layer-stat-sep">&middot;</span>' +
        '<span class="layer-stat">' + fileCount + ' files</span>' +
        '<span class="layer-stat-sep">&middot;</span>' +
        '<span class="layer-stat ' + (violationCount > 0 ? 'layer-stat-warn' : '') + '">' +
        violationCount + ' violation' + (violationCount !== 1 ? 's' : '') + ' (' + pct + '%)</span>';

      // Initial sync + start rAF loop
      syncLabelPositions();
      startLabelLoop();
    }

    function syncLabelPositions() {
      if (!cy || layerLabels.length === 0) return;
      layerLabels.forEach(label => {
        const bandNode = cy.getElementById(label.dataset.bandId);
        if (!bandNode || !bandNode.length) { label.style.display = 'none'; return; }
        const bb = bandNode.renderedBoundingBox();
        label.style.display = '';
        label.style.left = (bb.x1 + 10) + 'px';
        label.style.top  = (bb.y1 + 8)  + 'px';
      });
    }

    function labelLoop() {
      syncLabelPositions();
      labelRafId = requestAnimationFrame(labelLoop);
    }

    function startLabelLoop() {
      stopLabelLoop();
      labelRafId = requestAnimationFrame(labelLoop);
    }

    function stopLabelLoop() {
      if (labelRafId !== null) {
        cancelAnimationFrame(labelRafId);
        labelRafId = null;
      }
    }

    function clearLayerLabels() {
      stopLabelLoop();
      layerLabels.forEach(el => el.remove());
      layerLabels = [];
      const stats = document.getElementById('layerStatsBar');
      if (stats) stats.remove();
    }

    // ── Activate / Deactivate ──
    function activateLayers() {
      if (!cy || !graphData) return;
      layersActive = true;

      // Save current positions so we can restore on deactivate
      savedPositions = {};
      cy.nodes().forEach(n => { savedPositions[n.id()] = { ...n.position() }; });

      const nodeCount = cy.nodes().length;
      const positions = computeLayerPositions();

      // Mark violation edges
      markViolationEdges();

      // Apply full stylesheet: base styles + layer overrides
      cy.style(baseStyles.concat(layerStyles(nodeCount)));

      // Position nodes
      cy.batch(() => {
        cy.nodes().forEach(n => {
          const pos = positions[n.id()];
          if (pos) n.position(pos);
        });
      });
      cy.fit(60);

      // Draw swim-lane bands, labels, stats
      drawLayerBands(positions);
      drawLayerLabels(positions);

      // Violation pulse
      startViolationPulse();

      // Populate sidebar info panel
      populateLayersInfo();

      // Install drag-to-reassign handlers
      installLayerDragHandlers();
    }

    function deactivateLayers() {
      layersActive = false;
      userLayers = null;
      layerOverrides = {};
      stopViolationPulse();
      removeLayerDragHandlers();

      if (cy) {
        cy.edges('.violation').removeClass('violation');
        cy.nodes('.violation-endpoint').removeClass('violation-endpoint');

        // Clear bands before restoring positions
        clearLayerBands();

        // Restore positions
        if (savedPositions) {
          cy.batch(() => {
            cy.nodes().forEach(n => {
              const pos = savedPositions[n.id()];
              if (pos) n.position(pos);
            });
          });
          savedPositions = null;
        }
        // Restore original styles
        cy.style(baseStyles);
        applyColorMode();
      }
      clearLayerLabels();
      document.getElementById('layersInfo').innerHTML = '';
    }

    // ── Sidebar info panel (grouped violations, worst offenders, breakdown) ──
    function populateLayersInfo() {
      const info = document.getElementById('layersInfo');
      if (!info || !cy) return;

      // Gather violations
      const violations = [];
      cy.edges('.violation').forEach(e => {
        const srcRank = effectiveRank(e.source().id());
        const tgtRank = effectiveRank(e.target().id());
        violations.push({
          source: e.source().id(), target: e.target().id(),
          srcRank: srcRank, tgtRank: tgtRank,
          srcName: rankName(srcRank), tgtName: rankName(tgtRank),
        });
      });

      // Group by source
      const bySource = {};
      violations.forEach(v => {
        if (!bySource[v.source]) bySource[v.source] = [];
        bySource[v.source].push(v);
      });

      // Count per file (as source or target)
      const fileCounts = {};
      violations.forEach(v => {
        fileCounts[v.source] = (fileCounts[v.source] || 0) + 1;
        fileCounts[v.target] = (fileCounts[v.target] || 0) + 1;
      });

      // Layer breakdown
      const layerInfo = {};
      cy.nodes().forEach(n => {
        if (n.data('isLayerBand')) return;
        const d = effectiveRank(n.id());
        const dir = dirOf(n.id());
        if (!layerInfo[d]) layerInfo[d] = { count: 0, dirs: {} };
        layerInfo[d].count++;
        layerInfo[d].dirs[dir] = (layerInfo[d].dirs[dir] || 0) + 1;
      });

      let html = '';

      // ---- Per-file overrides bar ----
      const overrideCount = Object.keys(layerOverrides).length;
      if (overrideCount > 0) {
        html += '<div class="layer-overrides-bar">' +
          '<span>' + overrideCount + ' file' + (overrideCount > 1 ? 's' : '') + ' reassigned</span>' +
          '<button id="btnResetOverrides">Reset all</button>' +
          '</div>';
      } else {
        html += '<div class="layers-hint" style="opacity:0.55;">Drag a node to another layer to simulate reassignment.</div>';
      }

      // ---- Violations section ----
      html += '<div class="panel-section-header">Violations <span class="count-badge' +
        (violations.length > 0 ? ' count-badge-warn' : '') + '">' + violations.length + '</span></div>';

      if (violations.length === 0) {
        html += '<div style="color:#22c55e;padding:4px 0;font-size:11px;">No upward violations detected. Clean architecture!</div>';
      } else {
        html += '<div class="layers-hint">Imports pointing upward (deeper file -> shallower layer).</div>';

        // Worst offenders
        const offenders = Object.entries(fileCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8);

        html += '<div class="panel-section-header" style="margin-top:0.5rem;">Worst Offenders</div>';
        offenders.forEach(function(entry) {
          const file = entry[0], count = entry[1];
          const short = file.length > 30 ? '...' + file.slice(-28) : file;
          html += '<div class="metric-row clickable" data-zoom="' + escHtml(file) + '" title="' + escHtml(file) + '">' +
            '<span class="metric-label">' + escHtml(short) + '</span>' +
            '<span class="badge badge-warn">' + count + '</span>' +
            '</div>';
        });

        // All violations grouped by source
        html += '<div class="panel-section-header" style="margin-top:0.5rem;">All Violations</div>';
        const sourceFiles = Object.keys(bySource).sort((a, b) =>
          bySource[b].length - bySource[a].length
        );

        sourceFiles.forEach(src => {
          const items = bySource[src];
          const shortSrc = src.length > 26 ? '...' + src.slice(-24) : src;
          html += '<div class="layers-violation-group">';
          html += '<div class="layers-violation-src" data-zoom="' + escHtml(src) + '" title="' + escHtml(src) + '">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>' +
            '<span>' + escHtml(shortSrc) + '</span>' +
            '<span class="badge badge-warn">' + items.length + '</span>' +
            '</div>';

          items.forEach(v => {
            const shortTgt = v.target.length > 24 ? '...' + v.target.slice(-22) : v.target;
            html += '<div class="layers-violation-edge" data-zoom="' + escHtml(v.target) + '" title="' + escHtml(v.target) + '">' +
              '-> ' + escHtml(shortTgt) +
              ' <span style="opacity:0.5;font-size:0.6rem;">' + escHtml(v.srcName) + ' -> ' + escHtml(v.tgtName) + '</span>' +
              '</div>';
          });
          html += '</div>';
        });
      }

      // ---- Layer breakdown ----
      html += '<div class="panel-section-header" style="margin-top:0.6rem;">Layer Breakdown</div>';
      const depths = Object.keys(layerInfo).map(Number).sort((a, b) => a - b);
      depths.forEach(d => {
        const linfo = layerInfo[d];
        const dirs = Object.entries(linfo.dirs).sort((a, b) => b[1] - a[1]);
        const topDirs = dirs.slice(0, 3).map(function(entry) {
          const dir = entry[0], c = entry[1];
          const short = dir === '.' ? '(root)' : (dir.length > 15 ? '...' + dir.slice(-13) : dir);
          return short + (c > 1 ? ' (' + c + ')' : '');
        }).join(', ');
        const extra = dirs.length > 3 ? ' +' + (dirs.length - 3) + ' more' : '';

        html += '<div class="metric-row">' +
          '<span class="metric-label"><strong>' + escHtml(rankName(d)) + '</strong> &nbsp;' + escHtml(topDirs) + extra + '</span>' +
          '<span class="metric-value">' + linfo.count + '</span>' +
          '</div>';
      });

      info.innerHTML = html;

      // Click-to-zoom handlers
      info.querySelectorAll('[data-zoom]').forEach(el => {
        el.addEventListener('click', () => {
          const fileId = el.getAttribute('data-zoom');
          const node = cy.getElementById(fileId);
          if (node && node.length) {
            cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 1.5) }, { duration: 400 });
            node.style({ 'border-width': 5, 'border-color': '#facc15', 'border-style': 'solid' });
            setTimeout(() => {
              if (layersActive) {
                const isEp = node.hasClass('violation-endpoint');
                node.style({
                  'border-width': isEp ? 3 : 0,
                  'border-color': isEp ? VIOLATION_COLOR : 'transparent',
                });
              } else {
                node.style({ 'border-width': 0, 'border-color': 'transparent' });
              }
            }, 1500);
          }
        });
      });

      // Reset all overrides button
      const resetBtn = document.getElementById('btnResetOverrides');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          layerOverrides = {};
          refreshLayers();
        });
      }
    }

    // ── Drag-to-reassign layer simulation ──
    function getLayerBandRanges() {
      if (!cy) return [];
      const ranges = [];
      cy.nodes('[?isLayerBand]').forEach(parent => {
        const rank = parent.data('layerRank');
        const bb = parent.boundingBox();
        if (bb && !isNaN(bb.y1) && !isNaN(bb.y2)) {
          ranges.push({ rank: rank, minY: bb.y1, maxY: bb.y2 });
        }
      });
      return ranges.sort((a, b) => a.minY - b.minY);
    }

    function rankAtYFromSnapshot(modelY) {
      const ranges = dragBandSnapshot || getLayerBandRanges();
      if (!ranges || ranges.length === 0) return null;
      // Exact hit
      for (const r of ranges) {
        if (modelY >= r.minY && modelY <= r.maxY) return r.rank;
      }
      // Nearest band
      let best = null, bestDist = Infinity;
      for (const r of ranges) {
        const mid = (r.minY + r.maxY) / 2;
        const dist = Math.abs(modelY - mid);
        if (dist < bestDist) { bestDist = dist; best = r.rank; }
      }
      return best;
    }

    function refreshLayers() {
      if (!layersActive || !cy) return;
      cy.edges('.violation').removeClass('violation');
      cy.nodes('.violation-endpoint').removeClass('violation-endpoint');
      clearLayerLabels();
      clearLayerBands();
      stopViolationPulse();

      const nodeCount = cy.nodes().length;
      const positions = computeLayerPositions();
      if (!positions || Object.keys(positions).length === 0) return;

      markViolationEdges();
      cy.style(baseStyles.concat(layerStyles(nodeCount)));

      cy.batch(() => {
        cy.nodes().forEach(n => {
          const pos = positions[n.id()];
          if (pos) n.position(pos);
        });
      });
      cy.fit(60);

      drawLayerBands(positions);
      drawLayerLabels(positions);
      startViolationPulse();
      populateLayersInfo();
    }

    function onLayerDragStart(e) {
      if (!layersActive) return;
      if (e.target.data('isLayerBand')) return;
      draggedNode = e.target;
      dragStartRank = effectiveRank(e.target.id());
      dragStartPos = { x: e.target.position('x'), y: e.target.position('y') };
      dragBandSnapshot = getLayerBandRanges();
    }

    function onLayerDragging(e) {
      if (!layersActive || !draggedNode) return;
      const modelY = draggedNode.position('y');
      const targetRank = rankAtYFromSnapshot(modelY);
      if (cy) cy.nodes('[?isLayerBand]').forEach(b => {
        const bandRank = b.data('layerRank');
        if (bandRank === targetRank && targetRank !== dragStartRank) {
          b.addClass('layer-band-hover');
        } else {
          b.removeClass('layer-band-hover');
        }
      });
    }

    function onLayerDragFree(e) {
      if (!layersActive || !cy) return;
      const node = e.target;
      if (node.data('isLayerBand')) return;
      const dropY = node.position('y');
      const targetRank = rankAtYFromSnapshot(dropY);

      if (cy) cy.nodes('[?isLayerBand]').removeClass('layer-band-hover');
      draggedNode = null;
      dragBandSnapshot = null;

      // If barely moved (just a click), snap back
      if (dragStartPos) {
        const dx = Math.abs(node.position('x') - dragStartPos.x);
        const dy = Math.abs(node.position('y') - dragStartPos.y);
        if (dx < 5 && dy < 5) { node.position(dragStartPos); refreshLayers(); return; }
      }

      if (targetRank === null || targetRank === dragStartRank) {
        refreshLayers(); return;
      }

      // Assign to new layer
      layerOverrides[node.id()] = targetRank;
      refreshLayers();
    }

    function installLayerDragHandlers() {
      if (!cy) return;
      removeLayerDragHandlers();
      cy.on('grab', 'node', onLayerDragStart);
      cy.on('drag', 'node', onLayerDragging);
      cy.on('free', 'node', onLayerDragFree);
    }

    function removeLayerDragHandlers() {
      if (cy) {
        cy.off('grab', 'node', onLayerDragStart);
        cy.off('drag', 'node', onLayerDragging);
        cy.off('free', 'node', onLayerDragFree);
      }
      draggedNode = null;
      dragStartRank = null;
      dragBandSnapshot = null;
      if (cy) cy.nodes('[?isLayerBand]').removeClass('layer-band-hover');
    }

    // Apply layers button
    document.getElementById('btnApplyLayers').addEventListener('click', () => {
      const raw = document.getElementById('layerInput').value.trim();
      const newLayers = raw ? raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : null;
      if (layersActive) {
        // Clean up current layers state without wiping userLayers
        stopViolationPulse();
        removeLayerDragHandlers();
        if (cy) {
          cy.edges('.violation').removeClass('violation');
          cy.nodes('.violation-endpoint').removeClass('violation-endpoint');
          clearLayerBands();
        }
        clearLayerLabels();
        layerOverrides = {};

        // Set the new layers and re-activate
        userLayers = newLayers;
        const nodeCount = cy.nodes().length;
        const positions = computeLayerPositions();
        if (!positions || Object.keys(positions).length === 0) return;
        markViolationEdges();
        cy.style(baseStyles.concat(layerStyles(nodeCount)));
        cy.batch(() => {
          cy.nodes().forEach(n => {
            const pos = positions[n.id()];
            if (pos) n.position(pos);
          });
        });
        cy.fit(60);
        drawLayerBands(positions);
        drawLayerLabels(positions);
        startViolationPulse();
        populateLayersInfo();
        installLayerDragHandlers();
      } else {
        userLayers = newLayers;
      }
    });
    document.getElementById('layerInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btnApplyLayers').click();
    });

    // ── Tree direction toggles ───────────────────────────────────
    document.getElementById('btnTreeDown').addEventListener('click', () => {
      treeDirection = 'downstream';
      document.getElementById('btnTreeDown').classList.add('active');
      document.getElementById('btnTreeUp').classList.remove('active');
      renderTree();
    });
    document.getElementById('btnTreeUp').addEventListener('click', () => {
      treeDirection = 'upstream';
      document.getElementById('btnTreeUp').classList.add('active');
      document.getElementById('btnTreeDown').classList.remove('active');
      renderTree();
    });

    // Back button — return to file picker
    document.getElementById('treeBackBtn').addEventListener('click', () => {
      treeRootNode = null;
      renderTree();
    });

    function buildTreeAdj() {
      if (!graphData) return { downstream: {}, upstream: {} };
      const downstream = {};
      const upstream = {};
      graphData.nodes.forEach(n => {
        downstream[n.data.id] = [];
        upstream[n.data.id] = [];
      });
      graphData.edges.forEach(e => {
        const src = e.data.source, tgt = e.data.target;
        if (downstream[tgt]) downstream[tgt].push(src);
        if (upstream[src]) upstream[src].push(tgt);
      });
      return { downstream, upstream };
    }

    function buildTreeBFS(rootId, adj) {
      const visited = new Set();
      visited.add(rootId);
      function build(nodeId, depth) {
        if (depth > 20) return { id: nodeId, children: [] };
        const children = [];
        const neighbors = (adj[nodeId] || []).slice().sort();
        for (const nid of neighbors) {
          if (!visited.has(nid)) {
            visited.add(nid);
            children.push(build(nid, depth + 1));
          }
        }
        return { id: nodeId, children };
      }
      return build(rootId, 0);
    }

    function treeRiskSummary(childNodes) {
      const palette = { critical:'#ef4444', high:'#f97316', warning:'#eab308', normal:'#3b82f6', entry:'#22c55e', system:'#6b7280' };
      const counts = {};
      childNodes.forEach(c => {
        const gn = graphData.nodes.find(n => n.data.id === c.id);
        const r = gn ? (gn.data.risk || 'normal') : 'normal';
        counts[r] = (counts[r] || 0) + 1;
      });
      const wrap = document.createElement('span');
      wrap.className = 'tree-risk-summary';
      for (const r of ['critical','high','warning','normal','entry']) {
        if (!counts[r]) continue;
        for (let i = 0; i < Math.min(counts[r], 5); i++) {
          const dot = document.createElement('span');
          dot.className = 'tree-risk-summary-dot';
          dot.style.background = palette[r];
          dot.title = counts[r] + ' ' + r;
          wrap.appendChild(dot);
        }
        if (counts[r] > 5) {
          const more = document.createElement('span');
          more.className = 'tree-risk-summary-more';
          more.textContent = '+' + (counts[r] - 5);
          wrap.appendChild(more);
        }
      }
      return wrap;
    }

    function createPickerFileItem(n) {
      const item = document.createElement('div');
      item.className = 'tree-file-picker-item';
      const id = n.data.id;

      // File type badge
      const ext = getFileExt(id);
      const iconInfo = FILE_TYPE_ICONS[ext];
      const badge = document.createElement('span');
      badge.className = 'tree-picker-item-badge';
      if (iconInfo) {
        badge.textContent = iconInfo.label;
        badge.style.background = iconInfo.bg;
        if (iconInfo.color) badge.style.color = iconInfo.color;
      } else {
        badge.textContent = ext.substring(0, 2).toUpperCase() || '?';
        badge.style.background = '#6b7280';
      }
      item.appendChild(badge);

      // File name (just base name)
      const baseName = id.includes('/') ? id.split('/').pop() : id;
      const nameSpan = document.createElement('span');
      nameSpan.className = 'tree-picker-item-name';
      nameSpan.textContent = baseName;
      item.appendChild(nameSpan);

      // Full path as muted suffix
      const pathSpan = document.createElement('span');
      pathSpan.className = 'tree-picker-item-path';
      pathSpan.textContent = id;
      item.appendChild(pathSpan);

      item.title = id;
      item.addEventListener('click', () => { treeRootNode = id; renderTree(); });
      return item;
    }

    function renderTreeNode(node, depth) {
      const wrapper = document.createElement('div');
      wrapper.className = 'tree-branch';

      // Card
      const card = document.createElement('div');
      card.className = 'tree-node' + (depth === 0 ? ' tree-node-root' : '');
      card.setAttribute('data-fileid', node.id);

      const left = document.createElement('div');
      left.className = 'tree-node-left';

      // File type badge
      const ext = getFileExt(node.id);
      const iconInfo = FILE_TYPE_ICONS[ext];
      const badge = document.createElement('span');
      badge.className = 'tree-file-type-badge';
      if (iconInfo) {
        badge.textContent = iconInfo.label;
        badge.style.background = iconInfo.bg;
        if (iconInfo.color) badge.style.color = iconInfo.color;
      } else {
        badge.textContent = ext.substring(0, 2).toUpperCase() || '?';
        badge.style.background = '#6b7280';
      }
      left.appendChild(badge);

      // Risk dot
      const gNode = graphData.nodes.find(n => n.data.id === node.id);
      const risk = gNode ? (gNode.data.risk || 'normal') : 'normal';
      const riskColor = RISK_COLORS[risk] || RISK_COLORS.normal;
      const dot = document.createElement('span');
      dot.className = 'tree-node-dot';
      dot.style.background = riskColor;
      dot.title = risk;
      left.appendChild(dot);

      // Name
      const nameEl = document.createElement('span');
      nameEl.className = 'tree-node-name';
      const baseName = node.id.includes('/') ? node.id.split('/').pop() : node.id;
      nameEl.textContent = baseName;
      nameEl.title = node.id;
      left.appendChild(nameEl);

      card.appendChild(left);

      // Right section
      const right = document.createElement('div');
      right.className = 'tree-node-right';
      if (node.children.length > 0) {
        right.appendChild(treeRiskSummary(node.children));
      }

      // Focus on graph button
      const focusBtn = document.createElement('button');
      focusBtn.className = 'tree-focus-btn';
      focusBtn.title = 'Focus on graph';
      focusBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>';
      focusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        switchView('graph');
        if (cy) {
          setTimeout(() => {
            const n = cy.getElementById(node.id);
            if (n.length) {
              cy.animate({ center: { eles: n }, zoom: 2 }, { duration: 400 });
              n.flashClass('highlighted', 1500);
            }
          }, 200);
        }
      });
      right.appendChild(focusBtn);

      card.appendChild(right);

      // Click to set as root
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        treeRootNode = node.id;
        renderTree();
      });

      // Double-click to open file
      card.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: 'openFile', fileId: node.id });
      });

      wrapper.appendChild(card);

      // Children
      if (node.children.length > 0) {
        const stem = document.createElement('div');
        stem.className = 'tree-stem';
        wrapper.appendChild(stem);

        const childrenRow = document.createElement('div');
        childrenRow.className = 'tree-children-row';

        for (const child of node.children) {
          const col = document.createElement('div');
          col.className = 'tree-child-col';

          const drop = document.createElement('div');
          drop.className = 'tree-drop';
          col.appendChild(drop);

          col.appendChild(renderTreeNode(child, depth + 1));
          childrenRow.appendChild(col);
        }

        if (node.children.length > 1) {
          const hbar = document.createElement('div');
          hbar.className = 'tree-hbar';
          childrenRow.appendChild(hbar);
          childrenRow.classList.add('tree-children-row-multi');
        }

        wrapper.appendChild(childrenRow);
      }

      return wrapper;
    }

    function positionTreeHbars(root) {
      const hbars = root.querySelectorAll('.tree-hbar');
      hbars.forEach(hbar => {
        const row = hbar.parentElement;
        if (!row) return;
        const cols = [];
        for (let i = 0; i < row.children.length; i++) {
          if (row.children[i].classList.contains('tree-child-col')) {
            cols.push(row.children[i]);
          }
        }
        if (cols.length < 2) return;
        const rowRect = row.getBoundingClientRect();
        const firstRect = cols[0].getBoundingClientRect();
        const lastRect = cols[cols.length - 1].getBoundingClientRect();
        hbar.style.left = (firstRect.left + firstRect.width / 2 - rowRect.left) + 'px';
        hbar.style.right = (rowRect.right - (lastRect.left + lastRect.width / 2)) + 'px';
      });
    }

    function initTreePanZoom(el, zoomLayer, zoomLabel, zoomControlsEl) {
      let isPanning = false;
      let startX = 0, startY = 0, sLeft = 0, sTop = 0;
      let scale = 1;
      const MIN_ZOOM = 0.15, MAX_ZOOM = 3;

      function applyZoom() {
        zoomLayer.style.transform = 'scale(' + scale + ')';
        zoomLabel.textContent = Math.round(scale * 100) + '%';
        requestAnimationFrame(() => requestAnimationFrame(() => positionTreeHbars(zoomLayer)));
      }

      el.addEventListener('wheel', e => {
        e.preventDefault();
        const delta = (e.ctrlKey || e.metaKey) ? (-e.deltaY * 0.01) : (e.deltaY > 0 ? -0.08 : 0.08);
        scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale + delta));
        applyZoom();
      }, { passive: false });

      // Bind click to the zoom controls element (may live outside scrollable area)
      (zoomControlsEl || el).addEventListener('click', e => {
        const btn = e.target.closest('.tree-zoom-btn');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        if (action === 'in') scale = Math.min(MAX_ZOOM, scale + 0.15);
        else if (action === 'out') scale = Math.max(MIN_ZOOM, scale - 0.15);
        else if (action === 'reset') scale = 1;
        // Brief transition for button-triggered zooms only
        zoomLayer.style.transition = 'transform 0.12s ease';
        applyZoom();
        setTimeout(() => { zoomLayer.style.transition = ''; }, 140);
      });

      el.addEventListener('mousedown', e => {
        if (e.target.closest('button, input, .tree-node')) return;
        isPanning = true;
        startX = e.clientX; startY = e.clientY;
        sLeft = el.scrollLeft; sTop = el.scrollTop;
        el.classList.add('tree-grabbing');
        e.preventDefault();
      });
      el.addEventListener('mousemove', e => {
        if (!isPanning) return;
        el.scrollLeft = sLeft - (e.clientX - startX);
        el.scrollTop = sTop - (e.clientY - startY);
      });
      el.addEventListener('mouseup', () => { isPanning = false; el.classList.remove('tree-grabbing'); });
      el.addEventListener('mouseleave', () => { isPanning = false; el.classList.remove('tree-grabbing'); });
    }

    function renderTree() {
      if (treePendingRaf) { cancelAnimationFrame(treePendingRaf); treePendingRaf = null; }
      const container = document.getElementById('treeContainer');
      container.innerHTML = '';
      if (!graphData || !graphData.nodes.length) {
        container.innerHTML = '<div class="tree-empty"><div class="tree-empty-title">No graph data loaded.</div></div>';
        return;
      }

      // Update root chip / back button
      const chip = document.getElementById('treeRootChip');
      const backBtn = document.getElementById('treeBackBtn');
      if (treeRootNode) {
        chip.textContent = treeRootNode;
        chip.style.display = '';
        if (backBtn) backBtn.style.display = '';
      } else {
        chip.style.display = 'none';
        if (backBtn) backBtn.style.display = 'none';
      }

      // No root — show searchable, folder-grouped file picker
      if (!treeRootNode) {
        const prompt = document.createElement('div');
        prompt.className = 'tree-empty';
        prompt.innerHTML = '<div class="tree-empty-title">Select a root file</div>' +
          '<div class="tree-empty-desc">Type to search, or browse by folder below.</div>';
        container.appendChild(prompt);

        // Search input
        const searchWrap = document.createElement('div');
        searchWrap.className = 'tree-picker-search-wrap';
        const searchIcon = document.createElement('span');
        searchIcon.className = 'tree-picker-search-icon';
        searchIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>';
        searchWrap.appendChild(searchIcon);
        const searchInput = document.createElement('input');
        searchInput.className = 'tree-picker-search';
        searchInput.type = 'text';
        searchInput.placeholder = 'Search files\u2026';
        searchInput.setAttribute('autocomplete', 'off');
        searchInput.setAttribute('spellcheck', 'false');
        searchWrap.appendChild(searchInput);
        container.appendChild(searchWrap);

        // Sort all nodes
        const sorted = graphData.nodes.slice().sort((a, b) => a.data.id.localeCompare(b.data.id));

        // Group by folder
        const folders = {};
        sorted.forEach(n => {
          const id = n.data.id;
          const lastSlash = id.lastIndexOf('/');
          const folder = lastSlash >= 0 ? id.substring(0, lastSlash) : '.';
          if (!folders[folder]) folders[folder] = [];
          folders[folder].push(n);
        });
        const folderNames = Object.keys(folders).sort();

        // Build the grouped picker
        const pickerList = document.createElement('div');
        pickerList.className = 'tree-file-picker';

        // Flat results area (shown during search)
        const searchResults = document.createElement('div');
        searchResults.className = 'tree-picker-results';
        searchResults.style.display = 'none';
        pickerList.appendChild(searchResults);

        // Folder groups area (shown when not searching)
        const foldersArea = document.createElement('div');
        foldersArea.className = 'tree-picker-folders';

        folderNames.forEach(folderName => {
          const group = document.createElement('div');
          group.className = 'tree-picker-folder-group';

          const header = document.createElement('div');
          header.className = 'tree-picker-folder-header';
          const arrow = document.createElement('span');
          arrow.className = 'tree-picker-folder-arrow';
          arrow.textContent = '\u25B6';
          header.appendChild(arrow);
          const folderIcon = document.createElement('span');
          folderIcon.className = 'tree-picker-folder-icon';
          folderIcon.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>';
          header.appendChild(folderIcon);
          const folderLabel = document.createElement('span');
          folderLabel.className = 'tree-picker-folder-name';
          folderLabel.textContent = folderName;
          header.appendChild(folderLabel);
          const countBadge = document.createElement('span');
          countBadge.className = 'tree-picker-folder-count';
          countBadge.textContent = String(folders[folderName].length);
          header.appendChild(countBadge);

          const fileListInner = document.createElement('div');
          fileListInner.className = 'tree-picker-folder-files';
          fileListInner.style.display = 'none';

          folders[folderName].forEach(n => {
            const item = createPickerFileItem(n);
            fileListInner.appendChild(item);
          });

          header.addEventListener('click', () => {
            const isOpen = fileListInner.style.display !== 'none';
            fileListInner.style.display = isOpen ? 'none' : '';
            arrow.textContent = isOpen ? '\u25B6' : '\u25BC';
            group.classList.toggle('tree-picker-folder-open', !isOpen);
          });

          group.appendChild(header);
          group.appendChild(fileListInner);
          foldersArea.appendChild(group);
        });

        pickerList.appendChild(foldersArea);
        container.appendChild(pickerList);

        // If only one folder, auto-expand it
        if (folderNames.length === 1) {
          const singleHeader = foldersArea.querySelector('.tree-picker-folder-header');
          if (singleHeader) singleHeader.click();
        }

        // Search behavior
        searchInput.oninput = () => {
          const q = searchInput.value.toLowerCase().trim();
          if (!q) {
            searchResults.style.display = 'none';
            searchResults.innerHTML = '';
            foldersArea.style.display = '';
            return;
          }
          foldersArea.style.display = 'none';
          searchResults.style.display = '';
          searchResults.innerHTML = '';
          let count = 0;
          sorted.forEach(n => {
            if (count >= 30) return;
            if (n.data.id.toLowerCase().includes(q)) {
              const item = createPickerFileItem(n);
              searchResults.appendChild(item);
              count++;
            }
          });
          if (count === 0) {
            const noMatch = document.createElement('div');
            noMatch.className = 'tree-picker-no-match';
            noMatch.textContent = 'No files match "' + searchInput.value + '"';
            searchResults.appendChild(noMatch);
          }
        };

        // Auto-focus the search input
        requestAnimationFrame(() => { searchInput.focus(); });

        return;
      }

      const { downstream, upstream } = buildTreeAdj();
      const adj = treeDirection === 'downstream' ? downstream : upstream;
      const treeData = buildTreeBFS(treeRootNode, adj);

      // Scrollable tree graph area
      const treeEl = document.createElement('div');
      treeEl.style.cssText = 'flex:1;overflow:auto;position:relative;cursor:grab;' +
        'background-image:radial-gradient(circle,var(--border) 1px,transparent 1px);background-size:28px 28px;';

      const zoomLayer = document.createElement('div');
      zoomLayer.className = 'tree-zoom-layer';
      zoomLayer.style.opacity = '0'; // Hide until hbars positioned
      zoomLayer.appendChild(renderTreeNode(treeData, 0));
      treeEl.appendChild(zoomLayer);
      container.appendChild(treeEl);

      // Zoom controls — appended to container (not treeEl) so they stay fixed
      const zoomControls = document.createElement('div');
      zoomControls.className = 'tree-zoom-controls';
      zoomControls.innerHTML =
        '<button class="tree-zoom-btn" data-action="in" title="Zoom in">+</button>' +
        '<span class="tree-zoom-level">100%</span>' +
        '<button class="tree-zoom-btn" data-action="out" title="Zoom out">&minus;</button>' +
        '<button class="tree-zoom-btn tree-zoom-reset" data-action="reset" title="Reset zoom">&#8634;</button>';
      container.appendChild(zoomControls);

      // Position hbars, center on root, then reveal
      treePendingRaf = requestAnimationFrame(() => {
        treePendingRaf = requestAnimationFrame(() => {
          treePendingRaf = null;
          positionTreeHbars(zoomLayer);
          const rootNode = zoomLayer.querySelector('.tree-node-root');
          if (rootNode) {
            const rootRect = rootNode.getBoundingClientRect();
            const treeRect = treeEl.getBoundingClientRect();
            const rootCenterX = rootRect.left - treeRect.left + treeEl.scrollLeft + rootRect.width / 2;
            const rootTopY = rootRect.top - treeRect.top + treeEl.scrollTop;
            treeEl.scrollLeft = rootCenterX - treeEl.clientWidth / 2;
            treeEl.scrollTop = Math.max(0, rootTopY - treeEl.clientHeight * 0.3);
          }
          // Reveal
          zoomLayer.style.transition = 'opacity 0.08s ease';
          zoomLayer.style.opacity = '1';
        });
      });

      // Pan + zoom
      initTreePanZoom(treeEl, zoomLayer, zoomControls.querySelector('.tree-zoom-level'), zoomControls);

      // Apply search filter if active
      const q = document.getElementById('search').value.toLowerCase().trim();
      if (q) filterTree(q);
    }

    function filterTree(query) {
      const container = document.getElementById('treeContainer');
      if (!container) return;
      const q = query.toLowerCase().trim();
      container.querySelectorAll('.tree-branch').forEach(branch => {
        const nodeEl = branch.querySelector('.tree-node');
        if (!nodeEl) return;
        if (nodeEl.classList.contains('tree-node-root')) return;
        if (!q) { branch.style.display = ''; return; }
        let anyMatch = false;
        branch.querySelectorAll('.tree-node').forEach(n => {
          if ((n.getAttribute('data-fileid') || '').toLowerCase().includes(q)) anyMatch = true;
        });
        branch.style.display = anyMatch ? '' : 'none';
      });
    }

    // Extend the search handler to also filter the tree
    const origSearchHandler = document.getElementById('search').oninput;
    document.getElementById('search').addEventListener('input', (e) => {
      if (currentView === 'tree') {
        filterTree(e.target.value);
      }
    });

    // When a node is clicked in the graph, also set tree root
    if (cy) {
      cy.on('tap', 'node', (e) => {
        treeRootNode = e.target.id();
      });
    }

    // Patch renderGraph to also hook tap for tree root
    const origRenderGraph = renderGraph;
    renderGraph = function(data) {
      origRenderGraph(data);
      if (cy) {
        cy.on('tap', 'node', (e) => {
          treeRootNode = e.target.id();
        });
      }
    };

    // ── Tell extension we're ready ────────────────────────────────
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const crypto = require('crypto') as typeof import('crypto');
  return crypto.randomBytes(16).toString('hex');
}
