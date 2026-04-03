// --- Utilities ---
function showToast(msg, ms = 3000) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
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

// --- State ---
let cy, currentGraphData = null, minimapCy = null, pathHighlightActive = false;
let currentLayout = 'cose', clusteringEnabled = false, bundlingEnabled = false;
let currentMode = 'local', currentUploadedFile = null;

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
    if (cy) { cy.layout(getLayoutConfig(name)).run(); updateMinimap(); }
}

(function restoreLayout() {
    const s = localStorage.getItem('layout');
    if (s) { currentLayout = s; const r = document.querySelector(`input[name="layoutMode"][value="${s}"]`); if (r) r.checked = true; }
})();

// --- Minimap ---
function updateMinimap() {
    if (!cy) return;
    if (minimapCy) minimapCy.destroy();
    minimapCy = cytoscape({
        container: document.getElementById('minimap'),
        elements: cy.elements().jsons(),
        style: [
            { selector: 'node', style: { width: 5, height: 5, 'background-color': 'data(color)', label: '' } },
            { selector: 'edge', style: { width: 0.5, 'line-color': '#94a3b8', 'target-arrow-shape': 'none' } },
            { selector: 'edge.cycle', style: { 'line-color': '#FF4136' } },
        ],
        layout: { name: 'preset' },
        userZoomingEnabled: false, userPanningEnabled: false, boxSelectionEnabled: false, autoungrabify: true,
    });
    minimapCy.fit();
}

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
    if (!q) { cy.nodes().style({ 'border-width': 0, 'border-color': 'transparent' }); return; }
    const nodes = cy.nodes().filter(n => n.id().toLowerCase().includes(q));
    cy.nodes().style({ 'border-width': 0, 'border-color': 'transparent' });
    if (nodes.length) {
        nodes.style({ 'border-width': 4, 'border-color': '#facc15', 'border-style': 'solid' });
        cy.animate({ center: { eles: nodes[0] }, zoom: 1.5 }, { duration: 500 });
    } else showToast('No matching files found');
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
    cy.on('tap', evt => { if (evt.target === cy) clearPathHighlight(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') clearPathHighlight(); });
    setTimeout(updateMinimap, 500);

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
            else { renderGraph(d); showDetectedLanguages(d.detected); }
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
            else { renderGraph(d); showDetectedLanguages(d.detected); }
            loading.classList.remove('active');
        }).catch(() => loading.classList.remove('active'));
}

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

loadGraph();
