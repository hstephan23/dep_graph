// --- Dev mode configuration ---
// Fetches config from the server and hides dev-only UI elements in production.
// In production mode, the graph auto-loads with the default "test_files" directory.
let _devMode = false;

async function _applyDevMode() {
    try {
        const res = await fetch('/api/config');
        if (res.ok) {
            const data = await res.json();
            _devMode = !!data.dev_mode;
        }
    } catch (e) {
        // Default to production (dev_mode = false) on error
    }
    if (!_devMode) {
        document.querySelectorAll('.dev-only').forEach(el => {
            el.style.display = 'none';
        });
        // Auto-load the default test_files graph in production
        if (typeof loadGraph === 'function') {
            loadGraph();
        }
    }
}

// --- CSRF token management ---
let _csrfToken = '';
async function _fetchCsrfToken(retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch('/api/csrf-token');
            if (res.ok) {
                const data = await res.json();
                _csrfToken = data.token || '';
                return;
            }
        } catch (e) { /* server may still be booting */ }
        // Wait before retrying (1s, 2s, 4s)
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
    }
    console.warn('Could not fetch CSRF token after retries');
}
_fetchCsrfToken();

function _csrfHeaders() {
    return { 'X-CSRF-Token': _csrfToken };
}

// --- Utilities ---
function _escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

function showToast(msg, ms = 3000) {
    const t = document.createElement('div');
    t.className = 'toast';
    const isError = msg.toLowerCase().startsWith('error') || msg.toLowerCase().includes('failed');
    const icon = isError
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    t.innerHTML = icon + '<span>' + _escapeHtml(msg) + '</span>';
    t.style.display = 'flex';
    t.style.alignItems = 'center';
    t.style.gap = '0.5rem';
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('visible'));
    setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 300); }, ms);
}

const tooltip = document.createElement('div');
tooltip.className = 'custom-tooltip';
document.body.appendChild(tooltip);

function attachTooltip(el, text) {
    el.addEventListener('mouseenter', () => {
        tooltip.textContent = text;
        const r = el.getBoundingClientRect();
        tooltip.style.left = r.left + r.width / 2 + 'px';
        tooltip.style.top = r.top - 8 + 'px';
        tooltip.style.transform = 'translate(-50%, -100%)';
        tooltip.classList.add('visible');
    });
    el.addEventListener('mouseleave', () => tooltip.classList.remove('visible'));
}

// --- Folder Color Key ---
function toggleFolderKey() {
    document.getElementById('folderColorKey').classList.toggle('open');
}

function buildFolderColorKey(nodes) {
    const folderMap = {};
    nodes.forEach(n => {
        const id = n.data.id;
        const dir = id.includes('/') ? id.substring(0, id.lastIndexOf('/')) : '.';
        if (!folderMap[dir]) folderMap[dir] = n.data.color;
    });
    const list = document.getElementById('folderKeyList');
    list.innerHTML = '';
    const dirs = Object.keys(folderMap).sort();
    dirs.forEach(dir => {
        const entry = document.createElement('div');
        entry.className = 'folder-key-entry';
        entry.innerHTML = `<span class="folder-key-dot" style="background:${folderMap[dir]};"></span> ${dir}`;
        list.appendChild(entry);
    });
    const keyEl = document.getElementById('folderColorKey');
    if (dirs.length > 0) keyEl.style.display = 'flex';
    else keyEl.style.display = 'none';
}

// --- Theme ---
const ICON_MOON = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
const ICON_SUN = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';

document.documentElement.setAttribute('data-theme', localStorage.getItem('theme') || 'light');

function applyThemeIcon(t) { document.getElementById('themeIcon').innerHTML = t === 'dark' ? ICON_SUN : ICON_MOON; }

function toggleTheme() {
    const n = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', n);
    localStorage.setItem('theme', n);
    applyThemeIcon(n);
}

window.addEventListener('DOMContentLoaded', () => applyThemeIcon(document.documentElement.getAttribute('data-theme')));

// Apply dev mode (hide dev-only elements in production, auto-load graph)
window.addEventListener('DOMContentLoaded', () => _applyDevMode());

// --- Collapsible Panel Sections ---
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.panel-header').forEach(header => {
        header.addEventListener('click', () => {
            header.classList.toggle('collapsed');
            // Find next sibling elements until the next panel-header
            let el = header.nextElementSibling;
            while (el && !el.classList.contains('panel-header')) {
                el.style.display = header.classList.contains('collapsed') ? 'none' : '';
                el = el.nextElementSibling;
            }
        });
    });
});

// --- Sidebar Toggle (responsive + desktop) ---
let _sidebarHidden = false;

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (window.innerWidth <= 900) {
        // Mobile: slide-in overlay
        sidebar.classList.toggle('open');
        backdrop.classList.toggle('open');
    } else {
        // Desktop: toggle via inline styles (avoids CSS caching issues)
        _sidebarHidden = !_sidebarHidden;
        const minimap = document.getElementById('minimap');
        if (_sidebarHidden) {
            sidebar.setAttribute('style', 'display:none !important');
            if (minimap) minimap.style.right = '12px';
        } else {
            sidebar.removeAttribute('style');
            if (minimap) minimap.style.right = '';
            // Force Cytoscape to resize into the reclaimed space
            if (typeof cy !== 'undefined' && cy) {
                setTimeout(() => cy.resize(), 50);
            }
        }
    }
}

// --- State ---
let cy, currentGraphData = null, pathHighlightActive = false;
let currentLayout = 'cose';
let currentMode = 'local', currentUploadedFile = null, currentUploadToken = null;

// --- Sidebar tab switching ---
function switchTab(tab) {
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.panel).classList.add('active');
}

// --- Layout ---
function getLayoutConfig(name) {
    const l = name || currentLayout;
    if (l === 'dagre') return { name: 'dagre', rankDir: 'TB', nodeSep: 80, rankSep: 200, padding: 60 };
    if (l === 'concentric') return { name: 'concentric', concentric: n => n.indegree(), levelWidth: () => 2, padding: 60, minNodeSpacing: 80 };
    return { name: 'cose', padding: 200, nodeRepulsion: () => 80000000, idealEdgeLength: () => 800, edgeElasticity: () => 100, gravity: 50, numIter: 2000 };
}

function changeLayout(name) {
    currentLayout = name;
    localStorage.setItem('layout', name);
    if (cy) { cy.layout(getLayoutConfig(name)).run(); }
}

(function restoreLayout() {
    const s = localStorage.getItem('layout');
    if (s) { currentLayout = s; const r = document.querySelector(`input[name="layoutMode"][value="${s}"]`); if (r) r.checked = true; }
})();


// --- Path Highlighting ---
function highlightPaths(nodeId) {
    if (!cy) return;
    const node = cy.getElementById(nodeId);
    if (!node || !node.length) return;

    const bfs = (startId, getNeighbors) => {
        const visited = new Set();
        const queue = [startId];
        while (queue.length) {
            const cur = queue.shift();
            getNeighbors(cur).forEach(n => {
                if (!visited.has(n.id()) && n.id() !== startId) { visited.add(n.id()); queue.push(n.id()); }
            });
        }
        return visited;
    };

    const upstream = bfs(nodeId, id => cy.getElementById(id).outgoers('node'));
    const downstream = bfs(nodeId, id => cy.getElementById(id).incomers('node'));

    cy.elements().style('opacity', 0.12);
    node.style({ opacity: 1, 'border-width': 4, 'border-color': '#facc15' });

    upstream.forEach(id => cy.getElementById(id).style({ opacity: 1, 'background-color': '#6366f1' }));
    downstream.forEach(id => cy.getElementById(id).style({ opacity: 1, 'background-color': '#f97316' }));

    cy.edges().forEach(e => {
        const s = e.source().id(), t = e.target().id();
        if ((upstream.has(s) || s === nodeId) && (upstream.has(t) || t === nodeId))
            e.style({ opacity: 1, 'line-color': '#6366f1', 'target-arrow-color': '#6366f1' });
        if ((downstream.has(s) || s === nodeId) && (downstream.has(t) || t === nodeId))
            e.style({ opacity: 1, 'line-color': '#f97316', 'target-arrow-color': '#f97316' });
    });

    pathHighlightActive = true;
    document.getElementById('pathHint').style.display = 'block';
    showNodeAnalysis(nodeId, upstream.size, downstream.size);
}

function clearPathHighlight() {
    if (!cy || !pathHighlightActive) return;
    cy.elements().removeStyle();
    pathHighlightActive = false;
    document.getElementById('pathHint').style.display = 'none';
}

function showNodeAnalysis(nodeId, up, down) {
    const n = currentGraphData.nodes.find(n => n.data.id === nodeId);
    if (!n) return;
    const d = n.data;
    const el = document.getElementById('node-analysis');
    const bCls = (v, lo, hi) => v > hi ? 'badge-red' : v > lo ? 'badge-yellow' : 'badge-green';
    el.innerHTML = `
        <div class="node-card">
            <div class="node-card-header">${d.id}</div>
            <div class="metric-row"><span class="metric-label">Dep Depth</span><span class="badge ${bCls(d.depth, 2, 5)}">${d.depth}</span></div>
            <div class="metric-row"><span class="metric-label">Impact</span><span class="badge ${bCls(d.impact, 3, 10)}">${d.impact} file${d.impact !== 1 ? 's' : ''}</span></div>
            <div class="metric-row"><span class="metric-label">Stability (I)</span><span class="badge ${d.stability > 0.7 ? 'badge-red' : d.stability < 0.3 ? 'badge-green' : 'badge-yellow'}">${d.stability}</span></div>
            <div class="metric-row"><span class="metric-label">Upstream</span><span class="metric-value">${up}</span></div>
            <div class="metric-row"><span class="metric-label">Downstream</span><span class="metric-value">${down}</span></div>
        </div>`;
    switchTab(document.querySelector('[data-panel="panel-analysis"]'));
}

// --- Blast Radius (Reverse Dependency Lookup) ---
function showBlastRadius(nodeId) {
    if (!currentGraphData) return;

    // Build reverse adjacency map: target → [sources that import it]
    const revAdj = {};
    currentGraphData.nodes.forEach(n => revAdj[n.data.id] = []);
    currentGraphData.edges.forEach(e => {
        if (!revAdj[e.data.target]) revAdj[e.data.target] = [];
        revAdj[e.data.target].push(e.data.source);
    });

    // Direct dependents (files that directly import this file)
    const directDeps = revAdj[nodeId] || [];

    // Transitive dependents via BFS on reverse adjacency
    const transitive = new Set();
    const queue = [nodeId];
    const depthMap = {}; // nodeId → distance from selected node
    depthMap[nodeId] = 0;
    while (queue.length) {
        const cur = queue.shift();
        for (const dep of (revAdj[cur] || [])) {
            if (!transitive.has(dep) && dep !== nodeId) {
                transitive.add(dep);
                depthMap[dep] = (depthMap[cur] || 0) + 1;
                queue.push(dep);
            }
        }
    }

    // Group by depth level
    const byDepth = {};
    transitive.forEach(id => {
        const d = depthMap[id];
        if (!byDepth[d]) byDepth[d] = [];
        byDepth[d].push(id);
    });

    // Count total nodes in graph for percentage
    const totalNodes = currentGraphData.nodes.length;
    const pct = totalNodes > 0 ? Math.round((transitive.size / totalNodes) * 100) : 0;

    // Severity coloring
    const severityCls = pct > 40 ? 'badge-red' : pct > 15 ? 'badge-yellow' : 'badge-green';

    const el = document.getElementById('blast-content');
    let html = '';

    // Summary card
    html += `<div class="node-card">
        <div class="node-card-header">${nodeId}</div>
        <div class="metric-row"><span class="metric-label">Direct dependents</span><span class="badge badge-yellow">${directDeps.length}</span></div>
        <div class="metric-row"><span class="metric-label">Total blast radius</span><span class="badge ${severityCls}">${transitive.size} file${transitive.size !== 1 ? 's' : ''} (${pct}%)</span></div>
    </div>`;

    if (transitive.size === 0) {
        html += '<div class="panel-hint" style="margin-top:0.5rem;">No files depend on this file. Changes here have zero blast radius.</div>';
        el.innerHTML = html;
        return;
    }

    // Direct dependents section
    if (directDeps.length > 0) {
        html += `<div class="panel-header" style="margin-top:0.5rem;">Direct Dependents <span class="count-badge">${directDeps.length}</span></div>`;
        directDeps.sort().forEach(dep => {
            html += `<div class="metric-row clickable blast-row" onclick="blastZoomTo('${dep}')" style="cursor:pointer;">
                <span class="metric-label"><span class="blast-depth-badge" style="background:#f97316;">1</span>${dep}</span>
            </div>`;
        });
    }

    // Transitive dependents by depth
    const depths = Object.keys(byDepth).map(Number).sort((a, b) => a - b);
    if (depths.length > 1 || (depths.length === 1 && depths[0] > 1)) {
        html += `<div class="panel-header" style="margin-top:0.5rem;">Transitive Dependents</div>`;
        depths.forEach(d => {
            if (d === 1) return; // already shown above as direct
            const files = byDepth[d].sort();
            html += `<div class="blast-depth-group">`;
            html += `<div class="blast-depth-label">Depth ${d} <span class="count-badge">${files.length}</span></div>`;
            files.forEach(dep => {
                html += `<div class="metric-row clickable blast-row" onclick="blastZoomTo('${dep}')" style="cursor:pointer;">
                    <span class="metric-label"><span class="blast-depth-badge" style="background:${d <= 2 ? '#f97316' : d <= 4 ? '#eab308' : '#94a3b8'};">${d}</span>${dep}</span>
                </div>`;
            });
            html += `</div>`;
        });
    }

    // Highlight button
    html += `<div style="margin-top:0.75rem;display:flex;gap:0.5rem;">
        <button class="btn btn-primary" onclick="highlightBlastRadius('${nodeId}')" style="flex:1;padding:0.4rem 0.65rem;font-size:0.75rem;">Highlight on Graph</button>
        <button class="btn btn-ghost" onclick="clearPathHighlight()" style="padding:0.4rem 0.65rem;font-size:0.75rem;">Clear</button>
    </div>`;

    el.innerHTML = html;
}

function blastZoomTo(nodeId) {
    if (!cy) return;
    const n = cy.getElementById(nodeId);
    if (n.length) cy.animate({ center: { eles: n }, zoom: 1.5 }, { duration: 400 });
}

function highlightBlastRadius(nodeId) {
    if (!cy || !currentGraphData) return;
    clearPathHighlight();

    // Build reverse adjacency
    const revAdj = {};
    currentGraphData.edges.forEach(e => {
        if (!revAdj[e.data.target]) revAdj[e.data.target] = [];
        revAdj[e.data.target].push(e.data.source);
    });

    // BFS to find all transitive dependents
    const affected = new Set();
    const queue = [nodeId];
    while (queue.length) {
        const cur = queue.shift();
        for (const dep of (revAdj[cur] || [])) {
            if (!affected.has(dep) && dep !== nodeId) {
                affected.add(dep);
                queue.push(dep);
            }
        }
    }

    // Dim everything, then highlight affected nodes
    cy.elements().style('opacity', 0.12);

    const node = cy.getElementById(nodeId);
    if (node.length) node.style({ opacity: 1, 'border-width': 4, 'border-color': '#facc15' });

    affected.forEach(id => {
        const n = cy.getElementById(id);
        if (n.length) n.style({ opacity: 1, 'background-color': '#f97316' });
    });

    // Highlight edges within the affected subgraph
    cy.edges().forEach(e => {
        const s = e.source().id(), t = e.target().id();
        if ((affected.has(s) || s === nodeId) && (affected.has(t) || t === nodeId)) {
            e.style({ opacity: 1, 'line-color': '#f97316', 'target-arrow-color': '#f97316' });
        }
    });

    pathHighlightActive = true;
    document.getElementById('pathHint').style.display = 'block';

    // Fit to show all affected nodes
    const affectedNodes = cy.collection();
    affectedNodes.merge(node);
    affected.forEach(id => { const n = cy.getElementById(id); if (n.length) affectedNodes.merge(n); });
    if (affectedNodes.length > 1) cy.animate({ fit: { eles: affectedNodes, padding: 60 } }, { duration: 500 });
}

// --- Path Finder ---
function updatePathDatalist() {
    if (!currentGraphData) return;
    const ids = currentGraphData.nodes.map(n => n.data.id).sort();
    ['pathFromList', 'pathToList'].forEach(listId => {
        const dl = document.getElementById(listId);
        dl.innerHTML = '';
        ids.forEach(id => { const o = document.createElement('option'); o.value = id; dl.appendChild(o); });
    });
}

function findPath() {
    if (!cy || !currentGraphData) { showToast('Load a graph first.'); return; }
    const fromId = document.getElementById('pathFromInput').value.trim();
    const toId = document.getElementById('pathToInput').value.trim();
    const resultEl = document.getElementById('path-result');

    if (!fromId || !toId) { showToast('Enter both file names.'); return; }
    if (fromId === toId) { showToast('Source and target are the same file.'); return; }

    const fromNode = cy.getElementById(fromId);
    const toNode = cy.getElementById(toId);
    if (!fromNode.length) { showToast('Source file not found in graph.'); return; }
    if (!toNode.length) { showToast('Target file not found in graph.'); return; }

    // BFS along edge direction (source → target) to find shortest path
    const parent = {};
    const visited = new Set([fromId]);
    const queue = [fromId];
    let found = false;

    while (queue.length && !found) {
        const cur = queue.shift();
        const neighbors = cy.getElementById(cur).outgoers('node');
        for (let i = 0; i < neighbors.length; i++) {
            const nid = neighbors[i].id();
            if (!visited.has(nid)) {
                visited.add(nid);
                parent[nid] = cur;
                if (nid === toId) { found = true; break; }
                queue.push(nid);
            }
        }
    }

    // If not found following edges forward, try reverse direction
    if (!found) {
        const parentRev = {};
        const visitedRev = new Set([fromId]);
        const queueRev = [fromId];
        let foundRev = false;

        while (queueRev.length && !foundRev) {
            const cur = queueRev.shift();
            const neighbors = cy.getElementById(cur).incomers('node');
            for (let i = 0; i < neighbors.length; i++) {
                const nid = neighbors[i].id();
                if (!visitedRev.has(nid)) {
                    visitedRev.add(nid);
                    parentRev[nid] = cur;
                    if (nid === toId) { foundRev = true; break; }
                    queueRev.push(nid);
                }
            }
        }

        if (foundRev) {
            // Reconstruct reverse path and display
            const path = [toId];
            let cur = toId;
            while (cur !== fromId) { cur = parentRev[cur]; path.unshift(cur); }
            highlightFoundPath(path, 'reverse');
            renderPathResult(path, 'reverse');
            return;
        }

        resultEl.innerHTML = '<div class="panel-hint" style="color:var(--danger);">No path found between these files.</div>';
        showToast('No path found.');
        return;
    }

    // Reconstruct forward path
    const path = [toId];
    let cur = toId;
    while (cur !== fromId) { cur = parent[cur]; path.unshift(cur); }
    highlightFoundPath(path, 'forward');
    renderPathResult(path, 'forward');
}

function renderPathResult(path, direction) {
    const resultEl = document.getElementById('path-result');
    const arrow = direction === 'forward' ? '→' : '←';
    const dirLabel = direction === 'forward' ? 'depends on' : 'is depended on by';
    const color = direction === 'forward' ? '#10b981' : '#6366f1';

    let html = `<div class="panel-header" style="margin-top:0;">Shortest Path <span class="count-badge">${path.length} files</span></div>`;
    html += `<div class="panel-hint" style="padding-top:0;">Direction: <strong style="color:${color};">${dirLabel}</strong></div>`;

    path.forEach((nodeId, i) => {
        const isFirst = i === 0;
        const isLast = i === path.length - 1;
        const div = `<div class="metric-row clickable" onclick="const n=cy.getElementById('${nodeId}');if(n.length)cy.animate({center:{eles:n},zoom:1.5},{duration:400});" style="cursor:pointer;">
            <span class="metric-label" style="font-weight:${isFirst || isLast ? '600' : '400'};">${isFirst ? '● ' : isLast ? '◎ ' : '→ '}${nodeId}</span>
            ${isFirst ? '<span class="badge badge-green">start</span>' : isLast ? '<span class="badge badge-green">end</span>' : ''}
        </div>`;
        html += div;
    });

    resultEl.innerHTML = html;
}

function highlightFoundPath(path, direction) {
    clearPathHighlight();
    if (!cy) return;

    const pathSet = new Set(path);
    const color = direction === 'forward' ? '#10b981' : '#6366f1';

    cy.elements().style('opacity', 0.12);

    // Highlight path nodes
    path.forEach((nodeId, i) => {
        const n = cy.getElementById(nodeId);
        if (!n.length) return;
        const isEndpoint = i === 0 || i === path.length - 1;
        n.style({
            opacity: 1,
            'background-color': color,
            'border-width': isEndpoint ? 4 : 2,
            'border-color': isEndpoint ? '#facc15' : color,
        });
    });

    // Highlight edges along the path
    for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        cy.edges().forEach(e => {
            const src = e.source().id(), tgt = e.target().id();
            const match = direction === 'forward'
                ? (src === a && tgt === b)
                : (src === b && tgt === a);
            if (match) {
                e.style({ opacity: 1, 'line-color': color, 'target-arrow-color': color, width: 6 });
            }
        });
    }

    pathHighlightActive = true;

    // Fit view to path
    const pathNodes = cy.collection();
    path.forEach(id => { const n = cy.getElementById(id); if (n.length) pathNodes.merge(n); });
    if (pathNodes.length) cy.animate({ fit: { eles: pathNodes, padding: 80 } }, { duration: 500 });
}

function clearFoundPath() {
    clearPathHighlight();
    document.getElementById('path-result').innerHTML = '';
}

// --- Directory Collapse / Expand ---

// --- Layers ---
function checkLayers() {
    const input = document.getElementById('layerInput').value.trim();
    if (!input || !currentGraphData) return;
    fetch('/api/layers', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ..._csrfHeaders() },
        body: JSON.stringify({ layers: input.split(',').map(s => s.trim()).filter(Boolean), graph: currentGraphData }),
    }).then(r => r.json()).then(data => {
        const list = document.getElementById('violations-list');
        list.innerHTML = '';
        if (!data.violations || !data.violations.length) {
            list.innerHTML = '<div class="metric-row"><span class="metric-label" style="color:var(--success);">No violations found</span></div>';
            return;
        }
        data.violations.forEach(v => {
            const div = document.createElement('div');
            div.className = 'violation-row';
            div.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/></svg> ${v.source} <span style="color:var(--text-muted);">(${v.source_layer})</span> → ${v.target} <span style="color:var(--text-muted);">(${v.target_layer})</span>`;
            div.onclick = () => {
                clearPathHighlight();
                cy.edges().forEach(e => {
                    if (e.source().id() === v.source && e.target().id() === v.target) e.style({ 'line-color': '#ef4444', 'target-arrow-color': '#ef4444', width: 6 });
                });
                const src = cy.getElementById(v.source);
                if (src.length) cy.animate({ center: { eles: src }, zoom: 1.5 }, { duration: 400 });
            };
            list.appendChild(div);
        });
    }).catch(() => showToast('Error: Failed to check layers', 4000));
}

// --- Diff ---
function loadDiff() {
    const dir2 = document.getElementById('diffDirInput').value.trim();
    if (!dir2 || !currentGraphData) return;
    const filters = getFilterValues();
    fetch('/api/graph?' + new URLSearchParams({ dir: dir2, ...filters }))
        .then(r => r.json()).then(ng => {
            if (ng.error) { showToast('Error: ' + ng.error); return; }
            fetch('/api/diff', { method: 'POST', headers: { 'Content-Type': 'application/json', ..._csrfHeaders() }, body: JSON.stringify({ old: currentGraphData, new: ng }) })
                .then(r => r.json()).then(renderDiff)
                .catch(() => showToast('Error: Diff comparison failed', 4000));
        }).catch(() => showToast('Error: Failed to load second directory', 4000));
}

function renderDiff(diff) {
    if (cy) cy.destroy();
    diff.nodes.forEach(n => { n.data.color = n.data.diff === 'added' ? '#22c55e' : n.data.diff === 'removed' ? '#ef4444' : '#94a3b8'; n.data.size = n.data.size || 80; });
    diff.edges.forEach(e => { e.data.color = e.data.diff === 'added' ? '#22c55e' : e.data.diff === 'removed' ? '#ef4444' : '#cbd5e1'; });
    cy = cytoscape({
        container: document.getElementById('cy'),
        elements: [...diff.nodes, ...diff.edges],
        style: [
            { selector: 'node', style: { width: 'data(size)', height: 'data(size)', 'background-color': 'data(color)', label: 'data(id)', color: '#fff', 'text-outline-color': 'data(color)', 'text-outline-width': 2, 'font-size': '14px', 'text-valign': 'center', 'text-halign': 'center' } },
            { selector: 'edge', style: { width: 3, 'line-color': 'data(color)', 'target-arrow-color': 'data(color)', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier' } },
        ],
        layout: getLayoutConfig(),
    });
    const a = diff.nodes.filter(n => n.data.diff === 'added').length, r = diff.nodes.filter(n => n.data.diff === 'removed').length;
    const ae = diff.edges.filter(e => e.data.diff === 'added').length, re = diff.edges.filter(e => e.data.diff === 'removed').length;
    document.getElementById('diff-summary').innerHTML = `<div class="diff-summary"><span class="diff-added">+${a} nodes, +${ae} edges</span><span class="diff-removed">-${r} nodes, -${re} edges</span></div>`;
    showToast('Diff loaded');
}

// --- Exports ---
function exportJSON() {
    if (!currentGraphData) return;
    const a = document.createElement('a');
    a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentGraphData, null, 2));
    a.download = "dependency_graph.json"; document.body.appendChild(a); a.click(); a.remove();
}

function exportPNG() {
    if (!cy) return;
    const a = document.createElement('a');
    a.href = cy.png({ output: 'base64uri', bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(), full: true });
    a.download = "dependency_graph.png"; document.body.appendChild(a); a.click(); a.remove();
}

function exportDOT() {
    if (!currentGraphData) return;
    let s = 'digraph DependencyGraph {\n  node [shape=box, style=filled, fontname="Inter"];\n  rankdir=LR;\n';
    (currentGraphData.nodes || []).forEach(n => { s += `  "${n.data.id}" [fillcolor="${n.data.color || '#ccc'}"];\n`; });
    (currentGraphData.edges || []).forEach(e => {
        const cyc = e.classes && e.classes.includes('cycle');
        s += `  "${e.data.source}" -> "${e.data.target}" [${cyc ? 'color="red", penwidth=2' : `color="${e.data.color || '#94a3b8'}"`}];\n`;
    });
    s += '}\n';
    const a = document.createElement('a');
    a.href = "data:text/vnd.graphviz;charset=utf-8," + encodeURIComponent(s);
    a.download = "dependency_graph.dot"; document.body.appendChild(a); a.click(); a.remove();
}

function exportMermaid() {
    if (!currentGraphData) return;

    // Sanitize node IDs for Mermaid — replace non-alphanumeric chars with underscores
    // but keep the original name for display labels
    const idMap = {};
    let counter = 0;
    function mermaidId(name) {
        if (idMap[name]) return idMap[name];
        const id = 'n' + (counter++);
        idMap[name] = id;
        return id;
    }

    // Group nodes by directory for subgraph support
    const dirMap = {};
    (currentGraphData.nodes || []).forEach(n => {
        const id = n.data.id;
        const dir = id.includes('/') ? id.substring(0, id.lastIndexOf('/')) : '.';
        if (!dirMap[dir]) dirMap[dir] = [];
        dirMap[dir].push(id);
    });

    // Detect cycle edges for styling
    const cycleEdges = new Set();
    (currentGraphData.edges || []).forEach(e => {
        if (e.classes && e.classes.includes('cycle')) {
            cycleEdges.add(e.data.source + '|' + e.data.target);
        }
    });

    let s = 'graph TD\n';

    // Emit subgraphs for directories with more than one file
    const dirs = Object.keys(dirMap).sort();
    const emittedInSubgraph = new Set();

    dirs.forEach(dir => {
        const files = dirMap[dir];
        if (files.length > 1 && dir !== '.') {
            const subId = dir.replace(/[^a-zA-Z0-9]/g, '_');
            s += `\n  subgraph ${subId}["${dir}"]\n`;
            files.forEach(f => {
                const label = f.includes('/') ? f.substring(f.lastIndexOf('/') + 1) : f;
                s += `    ${mermaidId(f)}["${label}"]\n`;
                emittedInSubgraph.add(f);
            });
            s += '  end\n';
        }
    });

    // Emit remaining nodes not in a subgraph
    (currentGraphData.nodes || []).forEach(n => {
        if (!emittedInSubgraph.has(n.data.id)) {
            s += `  ${mermaidId(n.data.id)}["${n.data.id}"]\n`;
        }
    });

    s += '\n';

    // Emit edges
    (currentGraphData.edges || []).forEach(e => {
        const src = mermaidId(e.data.source);
        const tgt = mermaidId(e.data.target);
        const isCycle = cycleEdges.has(e.data.source + '|' + e.data.target);
        if (isCycle) {
            s += `  ${src} -. cycle .-> ${tgt}\n`;
        } else {
            s += `  ${src} --> ${tgt}\n`;
        }
    });

    // Add cycle edge styling
    if (cycleEdges.size > 0) {
        s += '\n  linkStyle default stroke:#94a3b8\n';
    }

    const a = document.createElement('a');
    a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(s);
    a.download = "dependency_graph.mmd";
    document.body.appendChild(a); a.click(); a.remove();
    showToast('Exported Mermaid diagram (.mmd)');
}

// --- Search ---
function searchNode() {
    if (!cy) return;
    const q = document.getElementById('searchInput').value.toLowerCase();
    if (!q) {
        cy.nodes().style({ 'border-width': 0, 'border-color': 'transparent' });
        cy.nodes().style('opacity', 1);
        cy.edges().style('opacity', 0.7);
        return;
    }
    const matches = cy.nodes().filter(n => n.id().toLowerCase().includes(q));
    const nonMatches = cy.nodes().filter(n => !n.id().toLowerCase().includes(q));

    // Dim non-matching nodes
    nonMatches.style('opacity', 0.15);
    cy.edges().style('opacity', 0.08);

    // Highlight matches
    matches.style({
        'border-width': 4,
        'border-color': '#facc15',
        'border-style': 'solid',
        opacity: 1
    });

    if (matches.length) {
        cy.animate({ center: { eles: matches[0] }, zoom: 1.5 }, { duration: 500 });
        showToast(`Found ${matches.length} match${matches.length > 1 ? 'es' : ''}`);
    } else {
        cy.nodes().style('opacity', 1);
        cy.edges().style('opacity', 0.7);
        showToast('No matching files found');
    }
}

// --- Main Render ---
function renderGraph(data) {
    currentGraphData = data;
    const emptyState = document.getElementById('emptyState');
    emptyState.style.display = (!data.nodes || !data.nodes.length) ? 'block' : 'none';

    // Cycles
    const cyclesHeader = document.getElementById('cycles-header');
    const cyclesList = document.getElementById('cycles-list');
    const warning = document.getElementById('cycleWarning');
    if (data.has_cycles) {
        warning.style.display = 'flex';
        cyclesHeader.style.display = '';
        cyclesList.innerHTML = '';
        (data.cycles || []).forEach((cycle, i) => {
            const card = document.createElement('div');
            card.className = 'cycle-card';
            card.innerHTML = `<div class="cycle-card-title">Cycle ${i + 1} &middot; ${cycle.length} files</div>`;
            cycle.forEach(nid => {
                const row = document.createElement('div');
                row.className = 'cycle-card-node';
                row.textContent = nid;
                row.onclick = () => { const n = cy.getElementById(nid); if (n.length) cy.animate({ center: { eles: n }, zoom: 1.5 }, { duration: 400 }); };
                card.appendChild(row);
            });
            cyclesList.appendChild(card);
        });
    } else { warning.style.display = 'none'; cyclesHeader.style.display = 'none'; cyclesList.innerHTML = ''; }

    if (cy) cy.destroy();

    const elements = [...data.nodes, ...data.edges];

    cy = cytoscape({
        container: document.getElementById('cy'),
        elements,
        style: [
            { selector: 'node', style: {
                width: 'data(size)', height: 'data(size)', 'background-color': 'data(color)', label: 'data(id)',
                color: '#fff', 'text-outline-color': 'data(color)', 'text-outline-width': 2,
                'font-size': ele => Math.max(14, Math.min(36, (ele.data('size') || 80) / 8)) + 'px',
                'text-valign': 'center', 'text-halign': 'center',
            }},
            { selector: 'edge', style: { width: 4, 'line-color': 'data(color)', 'target-arrow-color': 'data(color)', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', opacity: 0.7 } },
            { selector: 'edge.cycle', style: { 'line-color': '#FF4136', 'target-arrow-color': '#FF4136', width: 3, opacity: 1 } },
        ],
        layout: getLayoutConfig(),
    });

    cy.on('tap', 'node', evt => { clearPathHighlight(); highlightPaths(evt.target.id()); showBlastRadius(evt.target.id()); });
    cy.on('dbltap', 'node', evt => openPreview(evt.target.id()));
    cy.on('tap', evt => { if (evt.target === cy) clearPathHighlight(); });
    // Escape handled by global shortcut system below

    // Attach minimap listeners
    attachMinimapListeners();

    // Show graph status bar, path hint, and folder color key
    if (data.nodes && data.nodes.length) {
        document.getElementById('graphStatusBar').style.display = 'flex';
        document.getElementById('pathHint').style.display = 'block';
        buildFolderColorKey(data.nodes);
        updatePathDatalist();
    }

    // --- Ref list ---
    const refList = document.getElementById('ref-list');
    refList.innerHTML = '';
    const inDeg = {};
    data.nodes.forEach(n => inDeg[n.data.id] = 0);
    data.edges.forEach(e => { if (inDeg[e.data.target] !== undefined) inDeg[e.data.target]++; });
    const sorted = data.nodes.map(n => ({ id: n.data.id, count: inDeg[n.data.id] })).sort((a, b) => b.count - a.count);
    const maxC = sorted.length ? sorted[0].count : 0;
    const godT = Math.max(10, maxC * 0.5);
    document.getElementById('nodeCountBadge').textContent = sorted.length;

    sorted.forEach(item => {
        const isGod = item.count >= godT && item.count > 0;
        const isOrphan = item.count === 0;
        const div = document.createElement('div');
        div.className = 'list-row';
        const left = document.createElement('div');
        left.className = 'list-row-left';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = true; cb.title = 'Toggle visibility';
        left.appendChild(cb);
        const name = document.createElement('span');
        name.className = 'file-name' + (isGod ? ' god' : isOrphan ? ' orphan' : '');
        name.textContent = item.id;
        left.appendChild(name);
        const pill = document.createElement('span');
        pill.className = 'count-pill';
        pill.textContent = item.count;
        div.appendChild(left);
        div.appendChild(pill);
        cb.onchange = (e) => { const n = cy.getElementById(item.id); if (n.length) n.style('display', e.target.checked ? 'element' : 'none'); };
        name.onclick = () => { const n = cy.getElementById(item.id); if (n.length) cy.animate({ center: { eles: n }, zoom: 1.5 }, { duration: 400 }); };
        refList.appendChild(div);
    });

    // --- Unused ---
    const ul = document.getElementById('unused-list');
    ul.innerHTML = '';
    const unused = data.unused_files || [];
    document.getElementById('unusedCountBadge').textContent = unused.length;
    if (!unused.length) { ul.innerHTML = '<div class="metric-row"><span class="metric-label" style="color:var(--success);">All files are referenced</span></div>'; }
    else unused.forEach(fid => {
        const d = document.createElement('div');
        d.className = 'metric-row clickable';
        d.innerHTML = `<span class="metric-label">${fid}</span><span class="badge badge-red">0 refs</span>`;
        d.onclick = () => { const n = cy.getElementById(fid); if (n.length) cy.animate({ center: { eles: n }, zoom: 1.5 }, { duration: 400 }); };
        ul.appendChild(d);
    });

    // --- Coupling ---
    const cl = document.getElementById('coupling-list');
    cl.innerHTML = '';
    const coupling = data.coupling || [];
    if (!coupling.length) cl.innerHTML = '<div class="metric-row"><span class="metric-label">No cross-directory edges</span></div>';
    else coupling.forEach(c => {
        const d = document.createElement('div');
        d.className = 'metric-row';
        d.innerHTML = `<span class="metric-label">${c.dir1} ↔ ${c.dir2}</span><span class="badge ${c.score > 0.3 ? 'badge-red' : c.score > 0.1 ? 'badge-yellow' : 'badge-green'}">${c.cross_edges} (${c.score})</span>`;
        cl.appendChild(d);
    });
}

// --- Upload ---
function handleZipSelect(e) { const f = e.target.files[0]; if (!f) return; currentUploadedFile = f; uploadZip(); e.target.value = ''; }

function updateGraph() { if (currentMode === 'upload' && currentUploadedFile) uploadZip(); else loadGraph(); }

function uploadZip() {
    if (!currentUploadedFile) return;
    currentMode = 'upload';
    const fd = new FormData(); fd.append('file', currentUploadedFile);
    for (const [k, v] of Object.entries(getFilterValues())) fd.append(k, v);
    document.getElementById('loading').classList.add('active');
    fetch('/api/upload', { method: 'POST', headers: _csrfHeaders(), body: fd })
        .then(r => r.json()).then(d => {
            if (d.error) showToast('Error: ' + d.error, 5000);
            else { currentUploadToken = d.upload_token || null; renderGraph(d); showDetectedLanguages(d.detected); }
            document.getElementById('loading').classList.remove('active');
        }).catch(() => { showToast('Upload failed.', 5000); document.getElementById('loading').classList.remove('active'); });
}

function getFilterValues() {
    const m = document.querySelector('input[name="langMode"]:checked').value;
    const common = { hide_system: document.getElementById('hideSystemHeaders').checked, hide_isolated: document.getElementById('hideIsolated').checked, filter_dir: document.getElementById('filterDirInput').value };
    if (m === 'auto') return { mode: 'auto', ...common };
    return { ...common, show_c: m === 'c' || m === 'cpp', show_h: m === 'c' || m === 'cpp', show_cpp: m === 'cpp', show_js: m === 'js', show_py: m === 'py', show_java: m === 'java', show_go: m === 'go', show_rust: m === 'rust', show_cs: m === 'cs' };
}

function showDetectedLanguages(det) {
    const el = document.getElementById('detectedLangs');
    if (!det) { el.style.display = 'none'; return; }
    const langs = [];
    if (det.has_c) langs.push('C'); if (det.has_h) langs.push('Headers'); if (det.has_cpp) langs.push('C++');
    if (det.has_js) langs.push('JS/TS'); if (det.has_py) langs.push('Python'); if (det.has_java) langs.push('Java');
    if (det.has_go) langs.push('Go'); if (det.has_rust) langs.push('Rust'); if (det.has_cs) langs.push('C#');
    el.textContent = langs.length ? 'Detected: ' + langs.join(', ') : 'No supported files detected';
    el.style.display = '';
}

function loadGraph() {
    currentMode = 'local';
    const loading = document.getElementById('loading');
    loading.classList.add('active');
    fetch('/api/graph?' + new URLSearchParams({ dir: document.getElementById('dirInput').value, ...getFilterValues() }))
        .then(r => r.json()).then(d => {
            if (d.error) showToast('Error: ' + d.error, 4000);
            else {
                renderGraph(d);
                showDetectedLanguages(d.detected);
                // Smooth fade-in transition
                const cy = document.getElementById('cy');
                cy.style.opacity = '0';
                requestAnimationFrame(() => {
                    cy.style.transition = 'opacity 0.4s ease';
                    cy.style.opacity = '1';
                });
            }
            loading.classList.remove('active');
        }).catch(() => loading.classList.remove('active'));
}

// --- File Preview Drawer ---
let previewOpen = false;
let previewDrawerHeight = 280;

function _getFileParams(fileId) {
    if (currentMode === 'upload' && currentUploadToken) {
        return { upload_token: currentUploadToken, path: fileId };
    }
    return { dir: document.getElementById('dirInput').value, path: fileId };
}

function getBaseDir() {
    if (currentMode === 'local') return document.getElementById('dirInput').value;
    if (currentMode === 'upload' && currentUploadToken) return currentUploadToken;
    return '';
}

function openPreview(fileId) {
    const dir = getBaseDir();
    if (!dir) { showToast('File preview only available for local directories'); return; }

    const drawer = document.getElementById('previewDrawer');
    const handle = document.getElementById('previewResizeHandle');

    document.getElementById('previewFileName').textContent = fileId;
    document.getElementById('previewMeta').textContent = 'Loading...';
    document.getElementById('previewCode').textContent = '';
    document.getElementById('previewCode').className = '';

    drawer.style.height = previewDrawerHeight + 'px';
    handle.style.bottom = previewDrawerHeight + 'px';
    drawer.classList.add('open');
    handle.classList.add('open');
    previewOpen = true;

    fetch('/api/file?' + new URLSearchParams(_getFileParams(fileId)))
        .then(r => r.json())
        .then(data => {
            if (data.error) {
                document.getElementById('previewMeta').textContent = '';
                document.getElementById('previewCode').textContent = data.error;
                return;
            }
            document.getElementById('previewMeta').textContent = `${data.lines} lines \u00b7 ${data.language}`;
            const codeEl = document.getElementById('previewCode');
            codeEl.className = 'language-' + data.language;
            codeEl.textContent = data.content;
            Prism.highlightElement(codeEl);
        })
        .catch(() => {
            document.getElementById('previewMeta').textContent = '';
            document.getElementById('previewCode').textContent = 'Failed to load file.';
        });
}

function closePreview() {
    document.getElementById('previewDrawer').classList.remove('open');
    document.getElementById('previewResizeHandle').classList.remove('open');
    previewOpen = false;
}

// Resize handle drag
(function initPreviewResize() {
    const handle = document.getElementById('previewResizeHandle');
    if (!handle) return;
    let dragging = false, startY = 0, startH = 0;

    handle.addEventListener('mousedown', e => {
        dragging = true;
        startY = e.clientY;
        startH = previewDrawerHeight;
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        const delta = startY - e.clientY;
        previewDrawerHeight = Math.max(120, Math.min(window.innerHeight * 0.7, startH + delta));
        document.getElementById('previewDrawer').style.height = previewDrawerHeight + 'px';
        handle.style.bottom = previewDrawerHeight + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
})();

// --- Dependency Rules ---
let depRules = [];
let ruleViolations = [];

function addRule() {
    const type = document.getElementById('ruleType').value;
    const source = document.getElementById('ruleSource').value.trim();
    const target = document.getElementById('ruleTarget').value.trim();
    if (!source || !target) { showToast('Both source and target patterns are required'); return; }
    depRules.push({ type, source, target });
    document.getElementById('ruleSource').value = '';
    document.getElementById('ruleTarget').value = '';
    renderRulesList();
    showToast('Rule added');
}

function removeRule(idx) {
    depRules.splice(idx, 1);
    renderRulesList();
    clearRuleViolations();
}

function renderRulesList() {
    const list = document.getElementById('rules-list');
    list.innerHTML = '';
    document.getElementById('ruleCountBadge').textContent = depRules.length;
    if (!depRules.length) {
        list.innerHTML = '<div class="panel-hint">No rules defined yet.</div>';
        return;
    }
    depRules.forEach((rule, i) => {
        const div = document.createElement('div');
        div.className = 'rule-card';
        const typeLabel = rule.type === 'forbidden' ? 'FORBIDDEN' : 'REQUIRED ONLY';
        const typeClass = rule.type === 'forbidden' ? 'rule-type-forbidden' : 'rule-type-required';
        div.innerHTML = `
            <div class="rule-card-header">
                <span class="rule-type-badge ${typeClass}">${typeLabel}</span>
                <button class="rule-remove-btn" onclick="removeRule(${i})" title="Remove rule">&times;</button>
            </div>
            <div class="rule-card-body">${rule.source} <span class="rule-arrow-small">\u2192</span> ${rule.target}</div>
        `;
        list.appendChild(div);
    });
}

function checkRules() {
    if (!depRules.length) { showToast('Add at least one rule first'); return; }
    if (!currentGraphData) { showToast('Generate a graph first'); return; }
    fetch('/api/rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ..._csrfHeaders() },
        body: JSON.stringify({ rules: depRules, graph: currentGraphData }),
    }).then(r => r.json()).then(data => {
        ruleViolations = data.violations || [];
        renderRuleViolations();
        applyRuleBadges();
        if (!ruleViolations.length) showToast('No violations found!');
        else showToast(`Found ${ruleViolations.length} violation${ruleViolations.length > 1 ? 's' : ''}`);
    }).catch(() => showToast('Error: Failed to check rules', 4000));
}

function renderRuleViolations() {
    const list = document.getElementById('rule-violations-list');
    list.innerHTML = '';
    document.getElementById('ruleViolationBadge').textContent = ruleViolations.length;
    if (!ruleViolations.length) {
        list.innerHTML = '<div class="metric-row"><span class="metric-label" style="color:var(--success);">All rules pass</span></div>';
        return;
    }
    ruleViolations.forEach(v => {
        const div = document.createElement('div');
        div.className = 'violation-row';
        const icon = v.rule_type === 'forbidden'
            ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>'
            : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/></svg>';
        div.innerHTML = `${icon} <span class="rule-violation-file">${v.source}</span> <span style="color:var(--text-muted);">\u2192</span> <span class="rule-violation-file">${v.target}</span>`;
        div.title = v.rule_desc;
        div.onclick = () => {
            clearPathHighlight();
            cy.edges().forEach(e => {
                if (e.source().id() === v.source && e.target().id() === v.target)
                    e.style({ 'line-color': '#ef4444', 'target-arrow-color': '#ef4444', width: 6 });
            });
            const src = cy.getElementById(v.source);
            if (src.length) cy.animate({ center: { eles: src }, zoom: 1.5 }, { duration: 400 });
        };
        list.appendChild(div);
    });
}

function applyRuleBadges() {
    if (!cy || !ruleViolations.length) return;
    // Count violations per node
    const counts = {};
    ruleViolations.forEach(v => {
        counts[v.source] = (counts[v.source] || 0) + 1;
    });
    // Remove existing badge overlays
    document.querySelectorAll('.rule-badge-overlay').forEach(el => el.remove());
    const container = document.getElementById('cy');
    // Add badge overlays positioned on graph nodes
    Object.entries(counts).forEach(([nodeId, count]) => {
        const node = cy.getElementById(nodeId);
        if (!node.length) return;
        const badge = document.createElement('div');
        badge.className = 'rule-badge-overlay';
        badge.id = 'rule-badge-' + nodeId.replace(/[^a-zA-Z0-9_-]/g, '_');
        badge.textContent = count;
        badge.title = `${count} rule violation${count > 1 ? 's' : ''} in ${nodeId}`;
        container.appendChild(badge);

        const updatePos = () => {
            const pos = node.renderedPosition();
            const w = node.renderedWidth();
            badge.style.left = (pos.x + w / 2 - 8) + 'px';
            badge.style.top = (pos.y - w / 2 - 8) + 'px';
        };
        updatePos();
        cy.on('pan zoom resize', updatePos);
    });
    // Tint violating edges red + dashed
    ruleViolations.forEach(v => {
        cy.edges().forEach(e => {
            if (e.source().id() === v.source && e.target().id() === v.target)
                e.style({ 'line-color': '#ef4444', 'target-arrow-color': '#ef4444', width: 4, 'line-style': 'dashed' });
        });
    });
}

function clearRuleViolations() {
    ruleViolations = [];
    document.getElementById('ruleViolationBadge').textContent = '0';
    document.getElementById('rule-violations-list').innerHTML = '<div class="panel-hint">Run "Check All" to validate rules against the graph.</div>';
    document.querySelectorAll('.rule-badge-overlay').forEach(el => el.remove());
    if (cy) cy.edges().removeStyle();
}

// ============================================================
// MINIMAP
// ============================================================

let minimapVisible = true;
let minimapRAF = null;

function toggleMinimap() {
    const el = document.getElementById('minimap');
    minimapVisible = !minimapVisible;
    if (minimapVisible) {
        el.classList.add('open');
        renderMinimap();
    } else {
        el.classList.remove('open');
        if (minimapRAF) { cancelAnimationFrame(minimapRAF); minimapRAF = null; }
    }
}

function renderMinimap() {
    if (!cy || !minimapVisible) return;

    const canvas = document.getElementById('minimapCanvas');
    const body = canvas.parentElement;
    const ctx = canvas.getContext('2d');

    // Size canvas to container (retina-aware)
    const dpr = window.devicePixelRatio || 1;
    const cw = body.clientWidth;
    const ch = body.clientHeight;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    ctx.scale(dpr, dpr);

    // Get full graph bounding box
    const bb = cy.elements().boundingBox();
    if (!bb || bb.w === 0 || bb.h === 0) return;

    // Add padding around graph bounds
    const pad = 40;
    const gx = bb.x1 - pad;
    const gy = bb.y1 - pad;
    const gw = bb.w + pad * 2;
    const gh = bb.h + pad * 2;

    // Compute scale to fit graph into canvas
    const scale = Math.min(cw / gw, ch / gh);
    const ox = (cw - gw * scale) / 2;
    const oy = (ch - gh * scale) / 2;

    // Clear
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    ctx.fillStyle = isDark ? '#111527' : '#e2e8f0';
    ctx.fillRect(0, 0, cw, ch);

    // Draw edges
    ctx.lineWidth = Math.max(0.5, 1 * scale);
    cy.edges().forEach(e => {
        if (e.style('display') === 'none') return;
        const sp = e.source().position();
        const tp = e.target().position();
        const sx = ox + (sp.x - gx) * scale;
        const sy = oy + (sp.y - gy) * scale;
        const tx = ox + (tp.x - gx) * scale;
        const ty = oy + (tp.y - gy) * scale;

        const color = e.style('line-color');
        ctx.strokeStyle = color || (isDark ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.35)');
        ctx.globalAlpha = parseFloat(e.style('opacity')) || 0.4;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // Draw nodes
    cy.nodes().forEach(n => {
        if (n.style('display') === 'none') return;
        const pos = n.position();
        const nx = ox + (pos.x - gx) * scale;
        const ny = oy + (pos.y - gy) * scale;
        const size = Math.max(2, ((n.data('size') || 80) / 2) * scale);

        ctx.fillStyle = n.data('color') || (isDark ? '#818cf8' : '#6366f1');
        ctx.globalAlpha = parseFloat(n.style('opacity')) || 1;
        ctx.beginPath();
        ctx.arc(nx, ny, size, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Update viewport rectangle
    updateMinimapViewport(gx, gy, gw, gh, scale, ox, oy, cw, ch);
}

function updateMinimapViewport(gx, gy, gw, gh, scale, ox, oy, cw, ch) {
    if (!cy) return;
    const vp = document.getElementById('minimapViewport');
    const ext = cy.extent(); // visible area in model coords

    // Map extent to canvas coords
    let vl = ox + (ext.x1 - gx) * scale;
    let vt = oy + (ext.y1 - gy) * scale;
    let vw = ext.w * scale;
    let vh = ext.h * scale;

    // Clamp to canvas
    vl = Math.max(0, vl);
    vt = Math.max(0, vt);
    vw = Math.min(cw - vl, vw);
    vh = Math.min(ch - vt, vh);

    vp.style.left = vl + 'px';
    vp.style.top = vt + 'px';
    vp.style.width = vw + 'px';
    vp.style.height = vh + 'px';

    // Store transform for click-to-pan
    vp.dataset.gx = gx;
    vp.dataset.gy = gy;
    vp.dataset.scale = scale;
    vp.dataset.ox = ox;
    vp.dataset.oy = oy;
}

// Sync minimap on pan/zoom
function scheduleMinimapUpdate() {
    if (!minimapVisible) return;
    if (minimapRAF) cancelAnimationFrame(minimapRAF);
    minimapRAF = requestAnimationFrame(renderMinimap);
}

// Click-to-pan on minimap body
(function initMinimapInteraction() {
    document.addEventListener('DOMContentLoaded', () => {
        const body = document.querySelector('.minimap-body');
        if (!body) return;

        let dragging = false;

        function panToMinimapPos(clientX, clientY) {
            if (!cy) return;
            const vp = document.getElementById('minimapViewport');
            const rect = body.getBoundingClientRect();
            const mx = clientX - rect.left;
            const my = clientY - rect.top;

            const gx = parseFloat(vp.dataset.gx);
            const gy = parseFloat(vp.dataset.gy);
            const sc = parseFloat(vp.dataset.scale);
            const ox = parseFloat(vp.dataset.ox);
            const oy = parseFloat(vp.dataset.oy);

            if (isNaN(sc) || sc === 0) return;

            // Convert minimap pixel to graph model coordinate
            const modelX = (mx - ox) / sc + gx;
            const modelY = (my - oy) / sc + gy;

            // Pan so the clicked model point is centered in the viewport
            const cyContainer = cy.container();
            const zoom = cy.zoom();
            cy.pan({
                x: cyContainer.clientWidth / 2 - modelX * zoom,
                y: cyContainer.clientHeight / 2 - modelY * zoom
            });
        }

        body.addEventListener('mousedown', e => {
            dragging = true;
            panToMinimapPos(e.clientX, e.clientY);
            e.preventDefault();
        });

        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            panToMinimapPos(e.clientX, e.clientY);
        });

        document.addEventListener('mouseup', () => { dragging = false; });
    });
})();

// Hook into Cytoscape events after graph render
function attachMinimapListeners() {
    if (!cy) return;
    cy.on('pan zoom resize', scheduleMinimapUpdate);
    cy.on('layoutstop', () => { setTimeout(renderMinimap, 100); });
    if (minimapVisible) renderMinimap();
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================

// --- Quick Jump (Cmd+K) ---
let quickjumpActiveIndex = -1;

function openQuickJump() {
    const modal = document.getElementById('quickjumpModal');
    if (!modal) return;
    const input = document.getElementById('quickjumpInput');
    const results = document.getElementById('quickjumpResults');
    const empty = document.getElementById('quickjumpEmpty');
    const hint = document.getElementById('quickjumpHint');
    input.value = '';
    results.innerHTML = '';
    empty.style.display = 'none';
    hint.style.display = '';
    quickjumpActiveIndex = -1;
    modal.classList.add('open');
    requestAnimationFrame(() => input.focus());
}

function closeQuickJump() {
    const modal = document.getElementById('quickjumpModal');
    if (modal) modal.classList.remove('open');
}

function isQuickJumpOpen() {
    const modal = document.getElementById('quickjumpModal');
    return modal && modal.classList.contains('open');
}

function quickjumpHighlightMatch(text, query) {
    if (!query) return _escapeHtml(text);
    const lower = text.toLowerCase();
    const qLower = query.toLowerCase();
    const idx = lower.indexOf(qLower);
    if (idx === -1) return _escapeHtml(text);
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + query.length);
    const after = text.slice(idx + query.length);
    return _escapeHtml(before) + '<mark>' + _escapeHtml(match) + '</mark>' + _escapeHtml(after);
}

function quickjumpSetActive(index) {
    const items = document.querySelectorAll('.quickjump-result-item');
    items.forEach(el => el.classList.remove('active'));
    quickjumpActiveIndex = index;
    if (items[index]) {
        items[index].classList.add('active');
        items[index].scrollIntoView({ block: 'nearest' });
    }
}

function quickjumpNavigate(nodeId) {
    closeQuickJump();
    if (!cy) return;
    const node = cy.getElementById(nodeId);
    if (!node || !node.length) { showToast('Node not found in graph'); return; }

    // Clear existing highlights
    clearPathHighlight();

    // Animate to node
    cy.animate({ center: { eles: node }, zoom: 1.5 }, { duration: 400, complete: () => {
        // Highlight paths from node after arriving
        highlightPaths(nodeId);
        showBlastRadius(nodeId);
    }});

    showToast('Jumped to ' + nodeId.split('/').pop());
}

function quickjumpSearch(query) {
    const results = document.getElementById('quickjumpResults');
    const empty = document.getElementById('quickjumpEmpty');
    const hint = document.getElementById('quickjumpHint');
    results.innerHTML = '';
    quickjumpActiveIndex = -1;

    if (!query) {
        empty.style.display = 'none';
        hint.style.display = '';
        return;
    }

    hint.style.display = 'none';

    if (!cy) {
        empty.style.display = '';
        empty.textContent = 'No graph loaded';
        return;
    }

    const q = query.toLowerCase();
    const nodes = cy.nodes();
    const matches = [];

    nodes.forEach(n => {
        const id = n.id();
        const lower = id.toLowerCase();
        if (!lower.includes(q)) return;
        // Score: prefer exact filename match, then start-of-segment match, then substring
        const filename = id.split('/').pop().toLowerCase();
        let score = 0;
        if (filename === q) score = 3;
        else if (filename.startsWith(q)) score = 2;
        else if (lower.startsWith(q)) score = 1;
        matches.push({ id, color: n.data('color'), inDegree: n.indegree(), score });
    });

    // Sort: highest score first, then by in-degree (most referenced first)
    matches.sort((a, b) => b.score - a.score || b.inDegree - a.inDegree);

    // Limit to 15 results for performance
    const capped = matches.slice(0, 15);

    if (!capped.length) {
        empty.style.display = '';
        empty.textContent = 'No matching files';
        return;
    }

    empty.style.display = 'none';

    capped.forEach((m, i) => {
        const item = document.createElement('div');
        item.className = 'quickjump-result-item';
        item.innerHTML =
            '<span class="quickjump-result-dot" style="background:' + m.color + '"></span>' +
            '<span class="quickjump-result-label">' + quickjumpHighlightMatch(m.id, query) + '</span>' +
            '<span class="quickjump-result-meta">' + m.inDegree + ' ref' + (m.inDegree !== 1 ? 's' : '') + '</span>';
        item.addEventListener('click', () => quickjumpNavigate(m.id));
        item.addEventListener('mouseenter', () => quickjumpSetActive(i));
        results.appendChild(item);
    });

    // Auto-select first result
    quickjumpSetActive(0);
}

// Attach events after DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('quickjumpInput');
    if (!input) return;

    input.addEventListener('input', () => quickjumpSearch(input.value.trim()));

    input.addEventListener('keydown', e => {
        const items = document.querySelectorAll('.quickjump-result-item');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            quickjumpSetActive(Math.min(quickjumpActiveIndex + 1, items.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            quickjumpSetActive(Math.max(quickjumpActiveIndex - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (items[quickjumpActiveIndex]) items[quickjumpActiveIndex].click();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeQuickJump();
        }
    });
});

const SHORTCUTS = [
    { section: 'General', items: [
        { keys: 'Cmd+K',       desc: 'Quick jump to file',             action: (e) => { e.preventDefault(); openQuickJump(); } },
        { keys: '?',           desc: 'Show / hide this help',          action: () => toggleShortcutHelp() },
        { keys: 'Escape',      desc: 'Close modal / clear selection',  action: () => {
            const modal = document.getElementById('shortcutModal');
            if (modal && modal.classList.contains('open')) { toggleShortcutHelp(); return; }
            const qt = document.getElementById('queryTerminal');
            if (qt && qt.classList.contains('open')) { if (_queryActive) clearQuery(); else toggleQueryTerminal(); return; }
            clearPathHighlight();
            if (previewOpen) closePreview();
        }},
        { keys: 't',           desc: 'Toggle light / dark theme',      action: () => toggleTheme() },
        { keys: 's',           desc: 'Toggle sidebar',                 action: () => toggleSidebar() },
    ]},
    { section: 'Graph', items: [
        { keys: 'q',           desc: 'Toggle query terminal',          action: () => toggleQueryTerminal() },
        { keys: 'g',           desc: 'Generate graph',                 action: () => loadGraph() },
        { keys: '/',           desc: 'Focus search',                   action: (e) => { e.preventDefault(); document.getElementById('searchInput').focus(); } },
        { keys: 'd',           desc: 'Focus directory input',          action: () => document.getElementById('dirInput').focus() },
        { keys: 'f',           desc: 'Fit graph to viewport',          action: () => { if (cy) cy.fit(undefined, 50); } },
        { keys: 'm',           desc: 'Toggle minimap',                  action: () => toggleMinimap() },
        { keys: 'z',           desc: 'Zoom to selected node',          action: () => { if (cy) { const sel = cy.nodes(':selected'); if (sel.length) cy.animate({ center: { eles: sel }, zoom: 2 }, { duration: 400 }); } } },
    ]},
    { section: 'Layout', items: [
        { keys: '1',           desc: 'Force layout',                   action: () => { changeLayout('cose'); document.getElementById('layoutCose').checked = true; showToast('Layout: Force'); } },
        { keys: '2',           desc: 'Hierarchy layout',               action: () => { changeLayout('dagre'); document.getElementById('layoutDagre').checked = true; showToast('Layout: Hierarchy'); } },
        { keys: '3',           desc: 'Concentric layout',              action: () => { changeLayout('concentric'); document.getElementById('layoutConcentric').checked = true; showToast('Layout: Concentric'); } },
    ]},
    { section: 'Panels', items: [
        { keys: 'Shift+1',     desc: 'Refs panel',                     action: () => activatePanel(0) },
        { keys: 'Shift+2',     desc: 'Analysis panel',                 action: () => activatePanel(1) },
        { keys: 'Shift+3',     desc: 'Unused panel',                   action: () => activatePanel(2) },
        { keys: 'Shift+4',     desc: 'Blast radius panel',             action: () => activatePanel(3) },
        { keys: 'Shift+5',     desc: 'Layers panel',                   action: () => activatePanel(4) },
        { keys: 'Shift+6',     desc: 'Rules panel',                    action: () => activatePanel(5) },
        { keys: 'Shift+7',     desc: 'Path finder panel',              action: () => activatePanel(6) },
        { keys: 'Shift+8',     desc: 'Diff panel',                     action: () => activatePanel(7) },
        { keys: 'Shift+9',     desc: 'Simulate panel',                 action: () => activatePanel(8) },
        { keys: 'Shift+0',     desc: 'Story mode panel',               action: () => activatePanel(9) },
    ]},
    { section: 'Export', items: [
        { keys: 'e j',         desc: 'Export JSON',                    action: () => exportJSON(),        combo: true },
        { keys: 'e p',         desc: 'Export PNG',                     action: () => exportPNG(),         combo: true },
        { keys: 'e d',         desc: 'Export DOT',                     action: () => exportDOT(),         combo: true },
        { keys: 'e m',         desc: 'Export Mermaid',                 action: () => exportMermaid(),     combo: true },
    ]},
];

function activatePanel(index) {
    const tabs = document.querySelectorAll('.sidebar-tab');
    if (tabs[index]) {
        switchTab(tabs[index]);
        // Ensure sidebar is visible on mobile
        const sidebar = document.getElementById('sidebar');
        if (!sidebar.classList.contains('open') && window.innerWidth <= 900) toggleSidebar();
    }
}

// --- Sequence key support (for "e j", "e p", etc.) ---
let pendingPrefix = null;
let pendingTimer = null;

function clearPendingPrefix() {
    pendingPrefix = null;
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
}

document.addEventListener('keydown', e => {
    // Cmd+K / Ctrl+K — Quick Jump (works even from inputs)
    if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (isQuickJumpOpen()) closeQuickJump();
        else openQuickJump();
        return;
    }

    // Ignore when typing in inputs/textareas/selects
    const tag = e.target.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;

    // Allow Escape even in input contexts
    if (e.key === 'Escape') {
        if (isQuickJumpOpen()) { closeQuickJump(); return; }
        if (isInput) { e.target.blur(); return; }
        for (const sec of SHORTCUTS) {
            for (const s of sec.items) {
                if (s.keys === 'Escape') { s.action(e); return; }
            }
        }
        return;
    }

    if (isInput) return;

    // Build the key string
    let keyStr = e.key;

    // Handle sequence combos (e.g. "e j")
    if (pendingPrefix) {
        const comboStr = pendingPrefix + ' ' + keyStr;
        clearPendingPrefix();
        for (const sec of SHORTCUTS) {
            for (const s of sec.items) {
                if (s.combo && s.keys === comboStr) { s.action(e); return; }
            }
        }
        return;
    }

    // Check if this key is a prefix for a combo
    const isPrefix = SHORTCUTS.some(sec => sec.items.some(s => s.combo && s.keys.startsWith(keyStr + ' ')));
    if (isPrefix) {
        pendingPrefix = keyStr;
        pendingTimer = setTimeout(clearPendingPrefix, 800);
        return;
    }

    // Handle Shift+number — map the symbol to Shift+N
    if (e.shiftKey) {
        const shiftMap = { '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0' };
        if (shiftMap[e.key]) keyStr = 'Shift+' + shiftMap[e.key];
    }

    // Direct match
    for (const sec of SHORTCUTS) {
        for (const s of sec.items) {
            if (!s.combo && s.keys === keyStr) { s.action(e); return; }
        }
    }
});

// --- Help modal toggle ---
function toggleShortcutHelp() {
    const modal = document.getElementById('shortcutModal');
    if (!modal) return;
    modal.classList.toggle('open');
}

// Build help modal content on load
window.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('shortcutModal');
    if (!modal) return;
    const grid = modal.querySelector('.shortcut-grid');
    if (!grid) return;

    SHORTCUTS.forEach(sec => {
        const section = document.createElement('div');
        section.className = 'shortcut-section';
        const heading = document.createElement('div');
        heading.className = 'shortcut-section-title';
        heading.textContent = sec.section;
        section.appendChild(heading);

        sec.items.forEach(s => {
            const row = document.createElement('div');
            row.className = 'shortcut-row';
            const keys = document.createElement('div');
            keys.className = 'shortcut-keys';
            // Split on + or space, but keep the separator type
            const parts = s.keys.split(/(\+| )/);
            const keyTokens = parts.filter(p => p !== '+' && p !== ' ' && p !== '');
            keyTokens.forEach((k, i) => {
                const kbd = document.createElement('kbd');
                const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
                kbd.textContent = k === 'Cmd' ? (isMac ? '\u2318' : 'Ctrl') : k;
                keys.appendChild(kbd);
                if (i < keyTokens.length - 1) {
                    const sep = document.createElement('span');
                    sep.className = 'shortcut-sep';
                    sep.textContent = s.combo ? 'then' : '+';
                    keys.appendChild(sep);
                }
            });
            const desc = document.createElement('span');
            desc.className = 'shortcut-desc';
            desc.textContent = s.desc;
            row.appendChild(keys);
            row.appendChild(desc);
            section.appendChild(row);
        });

        grid.appendChild(section);
    });
});

loadGraph();

// ============================================================
// REFACTOR SIMULATION
// ============================================================

let simNodes = [];   // node IDs to remove
let simEdges = [];   // {source, target} edges to remove

function simUpdateDatalist() {
    if (!currentGraphData) return;
    const ids = currentGraphData.nodes.map(n => n.data.id).sort();
    ['simNodeList', 'simEdgeFromList', 'simEdgeToList'].forEach(listId => {
        const dl = document.getElementById(listId);
        if (!dl) return;
        dl.innerHTML = '';
        ids.forEach(id => { const o = document.createElement('option'); o.value = id; dl.appendChild(o); });
    });
}

function simAddNode(nodeId) {
    const input = document.getElementById('simNodeInput');
    const id = nodeId || (input ? input.value.trim() : '');
    if (!id) return;
    if (simNodes.includes(id)) { showToast('Already in removal list'); return; }
    if (!currentGraphData || !currentGraphData.nodes.find(n => n.data.id === id)) {
        showToast('Node not found in graph'); return;
    }
    simNodes.push(id);
    if (input) input.value = '';
    simRenderItems();
    simHighlightRemovals();
}

function simRemoveNode(idx) {
    simNodes.splice(idx, 1);
    simRenderItems();
    simHighlightRemovals();
}

function simAddEdge(source, target) {
    const fromInput = document.getElementById('simEdgeFrom');
    const toInput = document.getElementById('simEdgeTo');
    const s = source || (fromInput ? fromInput.value.trim() : '');
    const t = target || (toInput ? toInput.value.trim() : '');
    if (!s || !t) { showToast('Both source and target are required'); return; }
    if (simEdges.find(e => e.source === s && e.target === t)) { showToast('Edge already in removal list'); return; }
    if (!currentGraphData || !currentGraphData.edges.find(e => e.data.source === s && e.data.target === t)) {
        showToast('Edge not found in graph'); return;
    }
    simEdges.push({ source: s, target: t });
    if (fromInput) fromInput.value = '';
    if (toInput) toInput.value = '';
    simRenderItems();
    simHighlightRemovals();
}

function simRemoveEdge(idx) {
    simEdges.splice(idx, 1);
    simRenderItems();
    simHighlightRemovals();
}

function simRenderItems() {
    const nodeList = document.getElementById('sim-node-list');
    const edgeList = document.getElementById('sim-edge-list');
    if (!nodeList || !edgeList) return;

    nodeList.innerHTML = '';
    simNodes.forEach((id, i) => {
        const div = document.createElement('div');
        div.className = 'sim-item';
        div.innerHTML = '<span class="sim-item-label">' + id + '</span><button class="sim-item-remove" onclick="simRemoveNode(' + i + ')" title="Remove">&times;</button>';
        nodeList.appendChild(div);
    });

    edgeList.innerHTML = '';
    simEdges.forEach((e, i) => {
        const div = document.createElement('div');
        div.className = 'sim-item';
        div.innerHTML = '<span class="sim-item-label">' + e.source + ' <span style="color:var(--text-muted);">\u2192</span> ' + e.target + '</span><button class="sim-item-remove" onclick="simRemoveEdge(' + i + ')" title="Remove">&times;</button>';
        edgeList.appendChild(div);
    });
}

function simHighlightRemovals() {
    if (!cy) return;
    cy.elements().removeStyle();
    pathHighlightActive = false;

    if (!simNodes.length && !simEdges.length) return;

    simNodes.forEach(id => {
        const n = cy.getElementById(id);
        if (n.length) n.style({ opacity: 0.3, 'border-width': 4, 'border-color': '#ef4444', 'border-style': 'dashed' });
    });

    simEdges.forEach(e => {
        cy.edges().forEach(edge => {
            if (edge.source().id() === e.source && edge.target().id() === e.target) {
                edge.style({ opacity: 0.3, 'line-color': '#ef4444', 'target-arrow-color': '#ef4444', 'line-style': 'dashed', width: 5 });
            }
        });
    });
}

function simReset() {
    simNodes = [];
    simEdges = [];
    simRenderItems();
    if (cy) cy.elements().removeStyle();
    pathHighlightActive = false;
    var r = document.getElementById('sim-results');
    if (r) r.innerHTML = '';
}

function runSimulation() {
    if (!currentGraphData) { showToast('Generate a graph first'); return; }
    if (!simNodes.length && !simEdges.length) { showToast('Add at least one node or edge to remove'); return; }

    const resultsEl = document.getElementById('sim-results');
    resultsEl.innerHTML = '<div class="panel-hint" style="opacity:0.6;">Running simulation...</div>';

    fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._csrfHeaders() },
        body: JSON.stringify({
            graph: currentGraphData,
            remove_nodes: simNodes,
            remove_edges: simEdges,
        }),
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) { showToast('Error: ' + data.error); resultsEl.innerHTML = ''; return; }
        renderSimResults(data);
        highlightSimResults(data);
        showToast('Simulation complete \u2014 ' + data.stats.broken_import_count + ' broken import' + (data.stats.broken_import_count !== 1 ? 's' : ''));
    })
    .catch(() => { showToast('Error: Simulation failed', 4000); resultsEl.innerHTML = ''; });
}

function renderSimResults(data) {
    const el = document.getElementById('sim-results');
    const s = data.stats;
    let html = '';

    const severity = s.broken_import_count > 5 ? 'badge-red' : s.broken_import_count > 0 ? 'badge-yellow' : 'badge-green';
    html += '<div class="node-card" style="margin-top:0.75rem;">'
        + '<div class="node-card-header">Simulation Results</div>'
        + '<div class="metric-row"><span class="metric-label">Nodes removed</span><span class="badge badge-yellow">' + s.removed_nodes.length + '</span></div>'
        + '<div class="metric-row"><span class="metric-label">Edges removed</span><span class="badge badge-yellow">' + s.removed_edges.length + '</span></div>'
        + '<div class="metric-row"><span class="metric-label">Broken imports</span><span class="badge ' + severity + '">' + s.broken_import_count + '</span></div>'
        + '<div class="metric-row"><span class="metric-label">Newly orphaned</span><span class="badge ' + (s.orphaned_count > 0 ? 'badge-yellow' : 'badge-green') + '">' + s.orphaned_count + '</span></div>'
        + '<div class="metric-row"><span class="metric-label">Cycles resolved</span><span class="badge ' + (s.cycles_resolved > 0 ? 'badge-green' : '') + '">' + s.cycles_resolved + '</span></div>'
        + '<div class="metric-row"><span class="metric-label">Cycles introduced</span><span class="badge ' + (s.cycles_introduced > 0 ? 'badge-red' : 'badge-green') + '">' + s.cycles_introduced + '</span></div>'
        + '<div class="metric-row"><span class="metric-label">Graph</span><span class="metric-value">' + s.original_node_count + ' \u2192 ' + s.new_node_count + ' nodes, ' + s.original_edge_count + ' \u2192 ' + s.new_edge_count + ' edges</span></div>'
        + '</div>';

    if (data.broken_imports.length > 0) {
        html += '<div class="panel-header" style="margin-top:0.75rem;">Broken Imports <span class="count-badge">' + data.broken_imports.length + '</span></div>';
        data.broken_imports.forEach(function(b) {
            var reason = b.reason === 'target_removed' ? 'file deleted' : 'edge removed';
            html += '<div class="metric-row clickable sim-broken-row" onclick="simZoomTo(\'' + b.file.replace(/'/g, "\\'") + '\')" style="cursor:pointer;">'
                + '<span class="metric-label"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> ' + b.file + '</span>'
                + '<span class="badge badge-red" style="font-size:0.6rem;">' + reason + '</span>'
                + '</div>';
            html += '<div class="sim-broken-detail">\u2192 can\'t import <strong>' + b.missing_dep + '</strong></div>';
        });
    }

    if (data.newly_orphaned.length > 0) {
        html += '<div class="panel-header" style="margin-top:0.75rem;">Newly Orphaned <span class="count-badge">' + data.newly_orphaned.length + '</span></div>';
        html += '<div class="panel-hint" style="padding-top:0;">These files lose all their importers and become unreferenced.</div>';
        data.newly_orphaned.forEach(function(id) {
            html += '<div class="metric-row clickable" onclick="simZoomTo(\'' + id.replace(/'/g, "\\'") + '\')" style="cursor:pointer;">'
                + '<span class="metric-label">' + id + '</span>'
                + '<span class="badge badge-yellow">orphaned</span>'
                + '</div>';
        });
    }

    if (data.resolved_cycles.length > 0) {
        html += '<div class="panel-header" style="margin-top:0.75rem;">Cycles Resolved <span class="count-badge" style="background:#22c55e;color:#fff;">' + data.resolved_cycles.length + '</span></div>';
        data.resolved_cycles.forEach(function(cycle) {
            html += '<div class="cycle-card" style="border-left-color:#22c55e;">'
                + '<div class="cycle-card-title" style="color:#22c55e;">\u2713 Resolved \u00b7 ' + cycle.length + ' files</div>';
            cycle.forEach(function(nid) { html += '<div class="cycle-card-node">' + nid + '</div>'; });
            html += '</div>';
        });
    }

    if (data.new_cycles.length > 0) {
        html += '<div class="panel-header" style="margin-top:0.75rem;">New Cycles Introduced <span class="count-badge" style="background:#ef4444;color:#fff;">' + data.new_cycles.length + '</span></div>';
        data.new_cycles.forEach(function(cycle) {
            html += '<div class="cycle-card">'
                + '<div class="cycle-card-title" style="color:#ef4444;">New cycle \u00b7 ' + cycle.length + ' files</div>';
            cycle.forEach(function(nid) { html += '<div class="cycle-card-node">' + nid + '</div>'; });
            html += '</div>';
        });
    }

    if (data.impact_changes.length > 0) {
        html += '<div class="panel-header" style="margin-top:0.75rem;">Impact Changes <span class="count-badge">' + data.impact_changes.length + '</span></div>';
        html += '<div class="panel-hint" style="padding-top:0;">Files whose blast radius changed.</div>';
        data.impact_changes.slice(0, 15).forEach(function(c) {
            var arrow = c.delta > 0 ? '\u2191' : '\u2193';
            var cls = c.delta > 0 ? 'badge-red' : 'badge-green';
            html += '<div class="metric-row clickable" onclick="simZoomTo(\'' + c.file.replace(/'/g, "\\'") + '\')" style="cursor:pointer;">'
                + '<span class="metric-label">' + c.file + '</span>'
                + '<span class="badge ' + cls + '">' + arrow + ' ' + c.old_impact + ' \u2192 ' + c.new_impact + '</span>'
                + '</div>';
        });
    }

    if (!data.broken_imports.length && !data.newly_orphaned.length && !data.new_cycles.length) {
        html += '<div class="panel-hint" style="margin-top:0.75rem;color:var(--success);">'
            + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle;margin-right:0.3rem;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
            + 'Clean removal \u2014 nothing breaks!'
            + '</div>';
    }

    el.innerHTML = html;
}

function highlightSimResults(data) {
    if (!cy) return;
    cy.elements().removeStyle();

    simNodes.forEach(function(id) {
        var n = cy.getElementById(id);
        if (n.length) n.style({ opacity: 0.2, 'border-width': 4, 'border-color': '#ef4444', 'border-style': 'dashed' });
    });

    simEdges.forEach(function(e) {
        cy.edges().forEach(function(edge) {
            if (edge.source().id() === e.source && edge.target().id() === e.target) {
                edge.style({ opacity: 0.2, 'line-color': '#ef4444', 'target-arrow-color': '#ef4444', 'line-style': 'dashed' });
            }
        });
    });

    var brokenFiles = new Set(data.broken_imports.map(function(b) { return b.file; }));
    brokenFiles.forEach(function(id) {
        var n = cy.getElementById(id);
        if (n.length) n.style({ 'border-width': 4, 'border-color': '#f97316', 'border-style': 'solid' });
    });

    data.newly_orphaned.forEach(function(id) {
        var n = cy.getElementById(id);
        if (n.length) n.style({ 'border-width': 3, 'border-color': '#eab308', 'border-style': 'dashed' });
    });

    pathHighlightActive = true;
}

function simZoomTo(nodeId) {
    if (!cy) return;
    var n = cy.getElementById(nodeId);
    if (n.length) cy.animate({ center: { eles: n }, zoom: 1.5 }, { duration: 400 });
}

// Hook: update sim datalist when graph loads
var _origRenderGraph = renderGraph;
renderGraph = function(data) {
    _origRenderGraph(data);
    simUpdateDatalist();
};

// ============================================================
// STORY MODE
// ============================================================

let storySteps = [];
let storyIndex = -1;

// Step type → icon + accent color
const STORY_THEME = {
    overview:     { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>', color: '#6366f1' },
    entry_points: { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>', color: '#22c55e' },
    hubs:         { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>', color: '#f97316' },
    depth:        { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>', color: '#8b5cf6' },
    cycles:       { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6"/><path d="M2.5 22v-6h6"/><path d="M2.5 15.5A10 10 0 0 1 5.68 5.68"/><path d="M21.5 8.5a10 10 0 0 1-3.18 9.82"/></svg>', color: '#ef4444' },
    risks:        { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>', color: '#eab308' },
    coupling:     { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>', color: '#06b6d4' },
    summary:      { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>', color: '#10b981' },
};

function storyLoad() {
    if (!currentGraphData) { showToast('Generate a graph first'); return; }

    var contentEl = document.getElementById('story-content');
    contentEl.innerHTML = '<div class="panel-hint" style="opacity:0.6;">Generating story...</div>';

    fetch('/api/story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._csrfHeaders() },
        body: JSON.stringify({ graph: currentGraphData }),
    })
    .then(function(r) {
        if (!r.ok) {
            return r.text().then(function(t) {
                var msg = 'Server error ' + r.status;
                try { msg = JSON.parse(t).error || msg; } catch(e) {}
                throw new Error(msg);
            });
        }
        return r.json();
    })
    .then(function(data) {
        if (data.error) { showToast('Error: ' + data.error); contentEl.innerHTML = ''; return; }
        storySteps = data.steps || [];
        storyIndex = -1;
        storyUpdateCounter();
        document.getElementById('storyPrevBtn').disabled = true;
        document.getElementById('storyNextBtn').disabled = storySteps.length === 0;
        contentEl.innerHTML = '';

        if (storySteps.length === 0) {
            contentEl.innerHTML = '<div class="panel-hint">No story to tell \u2014 the graph is empty.</div>';
            return;
        }

        // Render all step cards (collapsed), first one will expand on storyNext
        var html = '';
        storySteps.forEach(function(step, i) {
            var theme = STORY_THEME[step.step_type] || STORY_THEME.overview;
            html += '<div class="story-card" id="story-card-' + i + '" data-step="' + i + '" onclick="storyGoTo(' + i + ')">'
                + '<div class="story-card-marker" style="background:' + theme.color + ';">' + (i + 1) + '</div>'
                + '<div class="story-card-body">'
                + '<div class="story-card-title">' + theme.icon + ' ' + step.title + '</div>'
                + '<div class="story-card-narrative">' + step.narrative + '</div>'
                + '</div></div>';
        });
        contentEl.innerHTML = html;

        // Auto-advance to first step
        storyNext();
        showToast('Story loaded \u2014 ' + storySteps.length + ' steps');
    })
    .catch(function(err) {
        showToast('Error: ' + (err.message || 'Failed to generate story'), 4000);
        contentEl.innerHTML = '<div class="panel-hint" style="color:var(--danger);">' + (err.message || 'Failed to generate story') + '</div>';
    });
}

function storyGoTo(index) {
    if (index < 0 || index >= storySteps.length) return;
    storyIndex = index;
    storyUpdateCounter();
    storyUpdateCards();
    storyAnimateStep(storySteps[index]);

    document.getElementById('storyPrevBtn').disabled = index <= 0;
    document.getElementById('storyNextBtn').disabled = index >= storySteps.length - 1;

    storyUpdateProgressBar();
}

function storyNext() {
    if (storyIndex < storySteps.length - 1) {
        storyGoTo(storyIndex + 1);
    }
}

function storyPrev() {
    if (storyIndex > 0) storyGoTo(storyIndex - 1);
}

function storyUpdateCounter() {
    var el = document.getElementById('storyCounter');
    if (el) el.textContent = (storyIndex + 1) + ' / ' + storySteps.length;
}

function storyUpdateProgressBar() {
    var bar = document.getElementById('storyProgressBar');
    if (!bar || !storySteps.length) return;
    var pct = ((storyIndex + 1) / storySteps.length) * 100;
    bar.style.width = pct + '%';
}

function storyUpdateCards() {
    // Highlight active card, dim others
    storySteps.forEach(function(_, i) {
        var card = document.getElementById('story-card-' + i);
        if (!card) return;
        if (i === storyIndex) {
            card.classList.add('active');
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            card.classList.remove('active');
        }
    });
}

function storyAnimateStep(step) {
    if (!cy) return;
    var theme = STORY_THEME[step.step_type] || STORY_THEME.overview;

    // Reset graph styles
    cy.elements().removeStyle();
    pathHighlightActive = false;

    if (!step.highlight_nodes.length && !step.highlight_edges.length) {
        // Overview / summary — just fit everything
        cy.animate({ fit: { eles: cy.elements(), padding: 60 } }, { duration: 600 });
        return;
    }

    // Dim everything
    cy.elements().style('opacity', 0.1);

    // Highlight nodes
    var highlightedNodes = cy.collection();
    step.highlight_nodes.forEach(function(nid) {
        var n = cy.getElementById(nid);
        if (n.length) {
            n.style({ opacity: 1, 'border-width': 4, 'border-color': theme.color });
            highlightedNodes = highlightedNodes.union(n);
        }
    });

    // Highlight edges
    step.highlight_edges.forEach(function(e) {
        cy.edges().forEach(function(edge) {
            if (edge.source().id() === e.source && edge.target().id() === e.target) {
                edge.style({ opacity: 1, 'line-color': theme.color, 'target-arrow-color': theme.color, width: 5 });
                // Also ensure the connected nodes are visible
                edge.source().style('opacity', 1);
                edge.target().style('opacity', 1);
                highlightedNodes = highlightedNodes.union(edge.source()).union(edge.target());
            }
        });
    });

    pathHighlightActive = true;

    // Zoom to highlighted elements
    if (step.zoom_target) {
        var target = cy.getElementById(step.zoom_target);
        if (target.length) {
            cy.animate({ center: { eles: target }, zoom: 1.4 }, { duration: 600 });
        }
    } else if (highlightedNodes.length) {
        cy.animate({ fit: { eles: highlightedNodes, padding: 80 } }, { duration: 600 });
    }
}

// ================================================================
// QUERY TERMINAL
// ================================================================
let _queryMode = 'highlight'; // 'highlight' or 'isolate'
let _queryActive = false;
let _queryHistory = [];
let _queryHistoryIndex = -1;

function toggleQueryTerminal() {
    const el = document.getElementById('queryTerminal');
    el.classList.toggle('open');
    if (el.classList.contains('open')) {
        setTimeout(() => document.getElementById('queryInput').focus(), 100);
    }
}

function setQueryMode(mode) {
    _queryMode = mode;
    document.querySelectorAll('.query-mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
    // Re-apply current query if active
    if (_queryActive) {
        const input = document.getElementById('queryInput');
        if (input.value.trim()) executeQuery(input.value.trim());
    }
}

function handleQueryKeydown(e) {
    if (e.key === 'Enter') {
        const q = e.target.value.trim();
        if (q) {
            // Add to history
            if (!_queryHistory.length || _queryHistory[_queryHistory.length - 1] !== q) {
                _queryHistory.push(q);
            }
            _queryHistoryIndex = _queryHistory.length;
            executeQuery(q);
        }
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (_queryHistory.length && _queryHistoryIndex > 0) {
            _queryHistoryIndex--;
            e.target.value = _queryHistory[_queryHistoryIndex];
        }
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (_queryHistoryIndex < _queryHistory.length - 1) {
            _queryHistoryIndex++;
            e.target.value = _queryHistory[_queryHistoryIndex];
        } else {
            _queryHistoryIndex = _queryHistory.length;
            e.target.value = '';
        }
    } else if (e.key === 'Escape') {
        if (_queryActive) { clearQuery(); e.stopPropagation(); }
        else { toggleQueryTerminal(); e.stopPropagation(); }
    }
}

function runExampleQuery(el) {
    const code = el.querySelector('code');
    if (!code) return;
    const q = code.textContent;
    document.getElementById('queryInput').value = q;
    executeQuery(q);
}

function clearQuery() {
    _queryActive = false;
    document.getElementById('queryInput').value = '';
    document.getElementById('queryResultCount').classList.remove('visible');
    document.getElementById('queryResultsList').classList.remove('visible');
    document.getElementById('queryResultsList').innerHTML = '';
    document.getElementById('queryError').classList.remove('visible');
    document.getElementById('queryHints').style.display = '';
    document.querySelector('.query-clear-btn').classList.remove('visible');

    // Restore graph
    if (cy) {
        cy.elements().removeStyle();
        cy.nodes().forEach(n => n.style('display', 'element'));
        pathHighlightActive = false;
    }
}

// --- Query Parser ---
function parseQuery(raw) {
    const q = raw.trim().toLowerCase();

    // "files in cycles"
    if (/^files?\s+in\s+cycles?$/i.test(q)) {
        return { type: 'cycles' };
    }

    // "files with no downstream" / "files with no inbound"
    if (/^files?\s+with\s+no\s+(downstream|inbound)$/i.test(q)) {
        return { type: 'no_downstream' };
    }

    // "files with no upstream" / "files with no outbound"
    if (/^files?\s+with\s+no\s+(upstream|outbound)$/i.test(q)) {
        return { type: 'no_upstream' };
    }

    // "files matching <pattern>"
    const matchPat = q.match(/^files?\s+matching\s+(.+)$/i);
    if (matchPat) {
        return { type: 'matching', pattern: matchPat[1].trim() };
    }

    // "files in <directory>"
    const inDir = q.match(/^files?\s+in\s+(?!cycles)(.+)$/i);
    if (inDir) {
        return { type: 'in_dir', dir: inDir[1].trim() };
    }

    // "files where <conditions>"
    const wherePat = q.match(/^files?\s+where\s+(.+)$/i);
    if (wherePat) {
        return parseWhereConditions(wherePat[1]);
    }

    // Try just bare conditions: "inbound > 3"
    if (/^(inbound|outbound|depth|impact|stability)\s*[><=!]/.test(q)) {
        return parseWhereConditions(q);
    }

    return { type: 'error', message: 'Unrecognized query. Try: files where inbound > 3, files in cycles, files matching utils/' };
}

function parseWhereConditions(str) {
    const parts = str.split(/\s+and\s+/i);
    const conditions = [];

    for (const part of parts) {
        const m = part.trim().match(/^(inbound|outbound|depth|impact|stability)\s*(>=|<=|!=|>|<|=)\s*([\d.]+)$/);
        if (!m) {
            return { type: 'error', message: `Invalid condition: "${part.trim()}". Use: metric operator value (e.g., inbound > 3)` };
        }
        conditions.push({
            metric: m[1],
            op: m[2],
            value: parseFloat(m[3])
        });
    }

    return { type: 'where', conditions };
}

// --- Query Executor ---
function executeQuery(raw) {
    if (!cy || !currentGraphData) {
        showQueryError('No graph loaded. Generate a graph first.');
        return;
    }

    const parsed = parseQuery(raw);

    if (parsed.type === 'error') {
        showQueryError(parsed.message);
        return;
    }

    // Build node metrics
    const inDeg = {};
    const outDeg = {};
    currentGraphData.nodes.forEach(n => { inDeg[n.data.id] = 0; outDeg[n.data.id] = 0; });
    currentGraphData.edges.forEach(e => {
        if (inDeg[e.data.target] !== undefined) inDeg[e.data.target]++;
        if (outDeg[e.data.source] !== undefined) outDeg[e.data.source]++;
    });

    // Build cycle set
    const cycleNodes = new Set();
    if (currentGraphData.cycles) {
        currentGraphData.cycles.forEach(cycle => cycle.forEach(nid => cycleNodes.add(nid)));
    }

    // Evaluate each node
    const matches = [];

    currentGraphData.nodes.forEach(n => {
        const id = n.data.id;
        const metrics = {
            inbound: inDeg[id] || 0,
            outbound: outDeg[id] || 0,
            depth: n.data.depth || 0,
            impact: n.data.impact || 0,
            stability: parseFloat(n.data.stability) || 0,
        };

        let match = false;

        switch (parsed.type) {
            case 'cycles':
                match = cycleNodes.has(id);
                break;
            case 'no_downstream':
                match = metrics.inbound === 0;
                break;
            case 'no_upstream':
                match = metrics.outbound === 0;
                break;
            case 'matching':
                match = id.toLowerCase().includes(parsed.pattern.toLowerCase());
                break;
            case 'in_dir':
                match = id.toLowerCase().startsWith(parsed.dir.toLowerCase());
                break;
            case 'where':
                match = parsed.conditions.every(c => {
                    const v = metrics[c.metric];
                    switch (c.op) {
                        case '>':  return v > c.value;
                        case '<':  return v < c.value;
                        case '>=': return v >= c.value;
                        case '<=': return v <= c.value;
                        case '=':  return v === c.value;
                        case '!=': return v !== c.value;
                        default:   return false;
                    }
                });
                break;
        }

        if (match) {
            matches.push({ id, metrics, inCycle: cycleNodes.has(id) });
        }
    });

    // Sort by inbound desc
    matches.sort((a, b) => b.metrics.inbound - a.metrics.inbound);

    // Display results
    showQueryResults(matches, parsed);

    // Apply to graph
    applyQueryToGraph(matches.map(m => m.id));
}

function showQueryError(msg) {
    const errEl = document.getElementById('queryError');
    errEl.textContent = msg;
    errEl.classList.add('visible');
    document.getElementById('queryResultsList').classList.remove('visible');
    document.getElementById('queryResultCount').classList.remove('visible');
    document.getElementById('queryHints').style.display = 'none';
}

function showQueryResults(matches, parsed) {
    document.getElementById('queryError').classList.remove('visible');
    document.getElementById('queryHints').style.display = 'none';
    document.querySelector('.query-clear-btn').classList.add('visible');

    const countEl = document.getElementById('queryResultCount');
    countEl.textContent = matches.length + ' match' + (matches.length !== 1 ? 'es' : '');
    countEl.classList.add('visible');

    const listEl = document.getElementById('queryResultsList');
    listEl.innerHTML = '';
    listEl.classList.add('visible');

    matches.forEach(m => {
        const item = document.createElement('div');
        item.className = 'query-result-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'query-result-file';
        nameSpan.textContent = m.id;

        const badgesDiv = document.createElement('span');
        badgesDiv.className = 'query-result-badges';

        // Show relevant metric badges
        const addBadge = (text, cls) => {
            const b = document.createElement('span');
            b.className = 'query-result-badge' + (cls ? ' ' + cls : '');
            b.textContent = text;
            badgesDiv.appendChild(b);
        };

        if (m.inCycle) addBadge('cycle', 'badge-cycle');
        addBadge('in:' + m.metrics.inbound);
        addBadge('out:' + m.metrics.outbound);

        item.appendChild(nameSpan);
        item.appendChild(badgesDiv);

        // Click to zoom
        item.onclick = () => {
            const node = cy.getElementById(m.id);
            if (node.length) {
                cy.animate({ center: { eles: node }, zoom: 1.5 }, { duration: 400 });
            }
        };

        listEl.appendChild(item);
    });

    _queryActive = true;
}

function applyQueryToGraph(matchIds) {
    if (!cy) return;
    const matchSet = new Set(matchIds);

    if (_queryMode === 'highlight') {
        // Dim everything, highlight matches
        cy.elements().style('opacity', 0.12);
        cy.nodes().forEach(n => {
            n.style('display', 'element');
            if (matchSet.has(n.id())) {
                n.style({ opacity: 1, 'border-width': 4, 'border-color': '#10b981' });
            }
        });
        // Show edges between matched nodes
        cy.edges().forEach(e => {
            if (matchSet.has(e.source().id()) && matchSet.has(e.target().id())) {
                e.style({ opacity: 0.7 });
            }
        });
        pathHighlightActive = true;

        // Fit view to matched nodes
        const matchedEles = cy.nodes().filter(n => matchSet.has(n.id()));
        if (matchedEles.length) {
            cy.animate({ fit: { eles: matchedEles, padding: 80 } }, { duration: 500 });
        }
    } else {
        // Isolate: hide non-matches
        cy.elements().removeStyle();
        pathHighlightActive = false;
        cy.nodes().forEach(n => {
            if (matchSet.has(n.id())) {
                n.style({ 'display': 'element', 'border-width': 3, 'border-color': '#10b981' });
            } else {
                n.style('display', 'none');
            }
        });
        // Edges auto-hide when both endpoints are hidden

        // Fit to visible
        const visible = cy.nodes().filter(n => matchSet.has(n.id()));
        if (visible.length) {
            cy.animate({ fit: { eles: visible, padding: 80 } }, { duration: 500 });
        }
    }
}

