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

    /* View toggle (Graph / Tree) */
    .view-toggle { display: flex; gap: 2px; margin-right: 6px; }
    .view-toggle button { font-size: 11px; padding: 2px 8px; }

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
    .tree-file-picker {
      display: flex; flex-wrap: wrap; gap: 6px;
      justify-content: center; padding: 0 20px 20px; max-height: 300px; overflow-y: auto;
    }
    .tree-file-picker-item {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 11px; padding: 4px 10px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 6px; cursor: pointer;
      transition: box-shadow 0.15s, border-color 0.15s;
    }
    .tree-file-picker-item:hover {
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      border-color: var(--primary);
    }

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

      cy = cytoscape({
        container: document.getElementById('cy'),
        elements: [...nodes, ...edges],
        style: [
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
        ],
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
      currentView = view;
      const cyEl = document.getElementById('cy');
      const treeEl = document.getElementById('treeContainer');
      const graphTb = document.getElementById('graphToolbar');
      const treeTb = document.getElementById('treeToolbar');
      const legendEl = document.getElementById('legend');

      document.getElementById('btnViewGraph').classList.toggle('active', view === 'graph');
      document.getElementById('btnViewTree').classList.toggle('active', view === 'tree');

      if (view === 'graph') {
        cyEl.style.display = 'block';
        treeEl.classList.remove('active');
        graphTb.style.display = 'contents';
        treeTb.classList.remove('active');
        legendEl.style.display = 'flex';
      } else {
        cyEl.style.display = 'none';
        treeEl.classList.add('active');
        graphTb.style.display = 'none';
        treeTb.classList.add('active');
        legendEl.style.display = 'none';
        renderTree();
      }
    }

    document.getElementById('btnViewGraph').addEventListener('click', () => switchView('graph'));
    document.getElementById('btnViewTree').addEventListener('click', () => switchView('tree'));

    // Tree direction toggles
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

      // No root — show file picker
      if (!treeRootNode) {
        const empty = document.createElement('div');
        empty.className = 'tree-empty';
        empty.innerHTML = '<div class="tree-empty-title">Select a root file</div>' +
          '<div class="tree-empty-desc">Click a file below, or switch to Graph view and click a node.</div>';
        container.appendChild(empty);

        const picker = document.createElement('div');
        picker.className = 'tree-file-picker';
        graphData.nodes.slice().sort((a,b) => a.data.id.localeCompare(b.data.id)).forEach(n => {
          const item = document.createElement('div');
          item.className = 'tree-file-picker-item';
          item.textContent = n.data.id;
          item.addEventListener('click', () => { treeRootNode = n.data.id; renderTree(); });
          picker.appendChild(item);
        });
        container.appendChild(picker);
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
