// --- Utilities ---
function showToast(msg, ms = 3000) {
    const t = document.createElement('div');
    t.className = 'toast';
    const isError = msg.toLowerCase().startsWith('error') || msg.toLowerCase().includes('failed');
    const icon = isError
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    t.innerHTML = icon + '<span>' + msg + '</span>';
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
let currentLayout = 'cose', clusteringEnabled = false, bundlingEnabled = false;
let currentMode = 'local', currentUploadedFile = null, currentUploadDir = null;

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

// --- Toggles ---
function toggleClustering() { clusteringEnabled = document.getElementById('clusterDirs').checked; if (currentGraphData) renderGraph(currentGraphData); }
function toggleEdgeBundling() { bundlingEnabled = document.getElementById('bundleEdges').checked; if (currentGraphData) renderGraph(currentGraphData); }

// --- Layers ---
function checkLayers() {
    const input = document.getElementById('layerInput').value.trim();
    if (!input || !currentGraphData) return;
    fetch('/api/layers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    });
}

// --- Diff ---
function loadDiff() {
    const dir2 = document.getElementById('diffDirInput').value.trim();
    if (!dir2 || !currentGraphData) return;
    const filters = getFilterValues();
    fetch('/api/graph?' + new URLSearchParams({ dir: dir2, ...filters }))
        .then(r => r.json()).then(ng => {
            if (ng.error) { showToast('Error: ' + ng.error); return; }
            fetch('/api/diff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ old: currentGraphData, new: ng }) })
                .then(r => r.json()).then(renderDiff);
        });
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

    // Clustering
    let elements = [...data.nodes, ...data.edges];
    if (clusteringEnabled) {
        const dirs = new Set();
        data.nodes.forEach(n => {
            const d = n.data.id.includes('/') ? n.data.id.substring(0, n.data.id.lastIndexOf('/')) : '.';
            dirs.add(d); n.data.parent = 'dir_' + d;
        });
        dirs.forEach(d => elements.unshift({ data: { id: 'dir_' + d, label: d || '.' }, classes: 'compound' }));
    }

    // Edge bundling
    if (bundlingEnabled) {
        const bundleMap = {}, individual = [];
        data.edges.forEach(e => {
            const sd = e.data.source.includes('/') ? e.data.source.substring(0, e.data.source.lastIndexOf('/')) : '.';
            const td = e.data.target.includes('/') ? e.data.target.substring(0, e.data.target.lastIndexOf('/')) : '.';
            if (sd !== td) {
                const k = sd + '→' + td;
                if (!bundleMap[k]) bundleMap[k] = { sd, td, count: 0, color: e.data.color, edges: [] };
                bundleMap[k].count++; bundleMap[k].edges.push(e);
            } else individual.push(e);
        });
        const bundled = [];
        Object.values(bundleMap).forEach(b => {
            if (b.count > 1 && clusteringEnabled) bundled.push({ data: { source: 'dir_' + b.sd, target: 'dir_' + b.td, color: b.color, label: String(b.count), bundled: true } });
            else bundled.push(...b.edges);
        });
        elements = elements.filter(e => !e.data || !e.data.source);
        elements = [...elements, ...individual, ...bundled];
    }

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
            { selector: ':parent', style: {
                'background-color': 'rgba(99,102,241,0.04)', 'border-width': 1.5, 'border-color': 'rgba(99,102,241,0.2)',
                'border-style': 'dashed', label: 'data(label)', 'text-valign': 'top', 'text-halign': 'center',
                'font-size': '14px', color: 'var(--text-muted)', 'text-margin-y': -8, padding: 20,
            }},
            { selector: 'edge', style: { width: 4, 'line-color': 'data(color)', 'target-arrow-color': 'data(color)', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', opacity: 0.7 } },
            { selector: 'edge[label]', style: { label: 'data(label)', 'font-size': '11px', 'text-background-color': 'var(--bg-elevated)', 'text-background-opacity': 0.9, 'text-background-padding': '3px', width: ele => Math.min(12, 3 + parseInt(ele.data('label') || '0')) } },
            { selector: 'edge.cycle', style: { 'line-color': '#FF4136', 'target-arrow-color': '#FF4136', width: 3, opacity: 1 } },
        ],
        layout: getLayoutConfig(),
    });

    cy.on('tap', 'node', evt => { if (!evt.target.isParent()) { clearPathHighlight(); highlightPaths(evt.target.id()); } });
    cy.on('dbltap', 'node', evt => { if (!evt.target.isParent()) openPreview(evt.target.id()); });
    cy.on('tap', evt => { if (evt.target === cy) clearPathHighlight(); });
    // Escape handled by global shortcut system below

    // Attach minimap listeners
    attachMinimapListeners();

    // Show graph status bar and path hint
    if (data.nodes && data.nodes.length) {
        document.getElementById('graphStatusBar').style.display = 'flex';
        document.getElementById('pathHint').style.display = 'block';
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
    fetch('/api/upload', { method: 'POST', body: fd })
        .then(r => r.json()).then(d => {
            if (d.error) showToast('Error: ' + d.error, 5000);
            else { currentUploadDir = d.upload_dir || null; renderGraph(d); showDetectedLanguages(d.detected); }
            document.getElementById('loading').classList.remove('active');
        }).catch(() => { showToast('Upload failed.', 5000); document.getElementById('loading').classList.remove('active'); });
}

function getFilterValues() {
    const m = document.querySelector('input[name="langMode"]:checked').value;
    const common = { hide_system: document.getElementById('hideSystemHeaders').checked, hide_isolated: document.getElementById('hideIsolated').checked, filter_dir: document.getElementById('filterDirInput').value };
    if (m === 'auto') return { mode: 'auto', ...common };
    return { ...common, show_c: m === 'c' || m === 'cpp', show_h: m === 'c' || m === 'cpp', show_cpp: m === 'cpp', show_js: m === 'js', show_py: m === 'py', show_java: m === 'java', show_go: m === 'go', show_rust: m === 'rust' };
}

function showDetectedLanguages(det) {
    const el = document.getElementById('detectedLangs');
    if (!det) { el.style.display = 'none'; return; }
    const langs = [];
    if (det.has_c) langs.push('C'); if (det.has_h) langs.push('Headers'); if (det.has_cpp) langs.push('C++');
    if (det.has_js) langs.push('JS/TS'); if (det.has_py) langs.push('Python'); if (det.has_java) langs.push('Java');
    if (det.has_go) langs.push('Go'); if (det.has_rust) langs.push('Rust');
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

function getBaseDir() {
    if (currentMode === 'local') return document.getElementById('dirInput').value;
    if (currentMode === 'upload' && currentUploadDir) return currentUploadDir;
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

    fetch('/api/file?' + new URLSearchParams({ dir, path: fileId }))
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: depRules, graph: currentGraphData }),
    }).then(r => r.json()).then(data => {
        ruleViolations = data.violations || [];
        renderRuleViolations();
        applyRuleBadges();
        if (!ruleViolations.length) showToast('No violations found!');
        else showToast(`Found ${ruleViolations.length} violation${ruleViolations.length > 1 ? 's' : ''}`);
    });
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

let minimapVisible = false;
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
        if (n.style('display') === 'none' || n.isParent()) return;
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

const SHORTCUTS = [
    { section: 'General', items: [
        { keys: '?',           desc: 'Show / hide this help',          action: () => toggleShortcutHelp() },
        { keys: 'Escape',      desc: 'Close modal / clear selection',  action: () => {
            const modal = document.getElementById('shortcutModal');
            if (modal && modal.classList.contains('open')) { toggleShortcutHelp(); return; }
            clearPathHighlight();
            if (previewOpen) closePreview();
        }},
        { keys: 't',           desc: 'Toggle light / dark theme',      action: () => toggleTheme() },
        { keys: 's',           desc: 'Toggle sidebar',                 action: () => toggleSidebar() },
    ]},
    { section: 'Graph', items: [
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
        { keys: 'c',           desc: 'Toggle directory clustering',    action: () => { document.getElementById('clusterDirs').click(); } },
        { keys: 'b',           desc: 'Toggle edge bundling',           action: () => { document.getElementById('bundleEdges').click(); } },
    ]},
    { section: 'Panels', items: [
        { keys: 'Shift+1',     desc: 'Refs panel',                     action: () => activatePanel(0) },
        { keys: 'Shift+2',     desc: 'Analysis panel',                 action: () => activatePanel(1) },
        { keys: 'Shift+3',     desc: 'Unused panel',                   action: () => activatePanel(2) },
        { keys: 'Shift+4',     desc: 'Layers panel',                   action: () => activatePanel(3) },
        { keys: 'Shift+5',     desc: 'Rules panel',                    action: () => activatePanel(4) },
        { keys: 'Shift+6',     desc: 'Diff panel',                     action: () => activatePanel(5) },
    ]},
    { section: 'Export', items: [
        { keys: 'e j',         desc: 'Export JSON',                    action: () => exportJSON(),        combo: true },
        { keys: 'e p',         desc: 'Export PNG',                     action: () => exportPNG(),         combo: true },
        { keys: 'e d',         desc: 'Export DOT',                     action: () => exportDOT(),         combo: true },
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
    // Ignore when typing in inputs/textareas/selects
    const tag = e.target.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;

    // Allow Escape even in input contexts
    if (e.key === 'Escape') {
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
        const shiftMap = { '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6' };
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
                kbd.textContent = k;
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
