import * as vscode from 'vscode';
import * as path from 'path';
import { getGraph, getBlastRadius, getDependents, getDependencies } from './engine';

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
    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net;
             style-src 'unsafe-inline' https://fonts.googleapis.com;
             font-src https://fonts.gstatic.com;
             img-src data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.23.0/cytoscape.min.js"></script>
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
    #cy { width: 100%; height: calc(100vh - 48px); }
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
    .loading-spinner {
      width: 32px; height: 32px;
      border: 3px solid var(--border);
      border-top-color: var(--primary);
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
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
  </style>
</head>
<body>
  <div class="toolbar">
    <input class="search-input" id="search" type="text" placeholder="Search files... (/)">
    <button id="btnForce" class="active">Force</button>
    <button id="btnHierarchy">Hierarchy</button>
    <button id="btnConcentric">Concentric</button>
    <div class="spacer"></div>
    <div class="cycle-badge" id="cycleBadge">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
      <span id="cycleCount"></span>
    </div>
    <div class="stats" id="stats"></div>
  </div>
  <div id="cy"></div>
  <div class="loading" id="loading">
    <div class="loading-spinner"></div>
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
      }
    });

    // ── Graph rendering ───────────────────────────────────────────
    function renderGraph(data) {
      document.getElementById('loading').style.display = 'none';
      const nodes = data.nodes.map(n => ({ ...n }));
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
              'width': 2,
              'line-color': 'data(color)',
              'target-arrow-color': 'data(color)',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              'opacity': 0.7,
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
        minZoom: 0.1,
        maxZoom: 5,
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
        tooltip.innerHTML =
          '<div class="tooltip-title">' + d.id + '</div>' +
          '<div class="tooltip-row"><span class="tooltip-label">Depth</span><span>' + d.depth + '</span></div>' +
          '<div class="tooltip-row"><span class="tooltip-label">Impact</span><span>' + d.impact + '</span></div>' +
          '<div class="tooltip-row"><span class="tooltip-label">Stability</span><span>' + (d.stability || 0).toFixed(2) + '</span></div>' +
          '<div class="tooltip-row"><span class="tooltip-label">Reach</span><span>' + (d.reach_pct || 0).toFixed(1) + '%</span></div>';
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
        cy.fit(60);
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
        default:
          return { name: 'cose', animate: true, animationDuration: 300, nodeRepulsion: () => 8000, idealEdgeLength: () => 100 };
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

    // ── Tell extension we're ready ────────────────────────────────
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
