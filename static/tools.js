// ============================================================================
// tools.js - Interactive Tools Module
// ============================================================================
// Extracted from app.js: Fisheye/Focus+Context, Path highlighting, Blast radius,
// Path finder, Layer checking, Diff mode, Node search, and Folder color key.
// All globals from state.js are available (cy, currentGraphData, etc.).
// Functions from other modules are available in global scope.
// ============================================================================

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

// --- Fisheye / Focus+Context Distortion ---
// When enabled, nodes near the cursor are magnified and spaced out while
// distant nodes shrink, providing a smooth focus+context effect.

let _fisheye = {
    active: false,
    radius: 300,       // influence radius in model coordinates
    magnification: 2.5, // max scale factor for closest nodes
    minScale: 0.5,     // minimum scale for distant nodes
    restoreData: null,  // original sizes to restore on disable
    rafId: null,
};

function fisheyeToggle() {
    _fisheye.active = !_fisheye.active;
    const btn = document.getElementById('fisheyeToggle');
    if (btn) btn.classList.toggle('active', _fisheye.active);

    if (_fisheye.active) {
        if (!cy) return;
        // Store original node sizes
        _fisheye.restoreData = {};
        cy.nodes().forEach(n => {
            _fisheye.restoreData[n.id()] = {
                width: n.style('width'),
                height: n.style('height'),
                fontSize: n.style('font-size'),
            };
        });
        cy.on('mousemove', _fisheyeHandler);
        showToast('Focus lens enabled — move cursor to magnify', 2500);
    } else {
        if (cy) {
            cy.off('mousemove', _fisheyeHandler);
            _fisheyeRestore();
        }
        showToast('Focus lens disabled', 1500);
    }
}

function _fisheyeHandler(evt) {
    if (!_fisheye.active || !cy) return;
    if (_fisheye.rafId) cancelAnimationFrame(_fisheye.rafId);
    const pos = evt.position; // model coordinates
    _fisheye.rafId = requestAnimationFrame(() => _fisheyeApply(pos));
}

function _fisheyeApply(cursor) {
    if (!cy || !_fisheye.active) return;
    const R = _fisheye.radius;
    const mag = _fisheye.magnification;
    const minS = _fisheye.minScale;

    cy.batch(() => {
        cy.nodes().forEach(n => {
            const p = n.position();
            const dx = p.x - cursor.x;
            const dy = p.y - cursor.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            let scale;
            if (dist < R) {
                // Smooth falloff: full magnification at center, 1.0 at radius edge
                const t = 1 - (dist / R);
                // Ease-out cubic for smooth falloff
                scale = 1 + (mag - 1) * (t * t * (3 - 2 * t));
            } else {
                // Outside radius: slightly shrink for context effect
                const falloff = Math.min(1, (dist - R) / R);
                scale = 1 - (1 - minS) * Math.min(1, falloff);
            }

            const orig = _fisheye.restoreData[n.id()];
            if (!orig) return;
            const origW = parseFloat(orig.width);
            const origH = parseFloat(orig.height);
            const origF = parseFloat(orig.fontSize);

            n.style({
                'width': origW * scale,
                'height': origH * scale,
                'font-size': Math.max(8, origF * scale) + 'px',
            });
        });
    });
}

function _fisheyeRestore() {
    if (!cy || !_fisheye.restoreData) return;
    cy.batch(() => {
        cy.nodes().forEach(n => {
            const orig = _fisheye.restoreData[n.id()];
            if (orig) {
                n.style({
                    'width': orig.width,
                    'height': orig.height,
                    'font-size': orig.fontSize,
                });
            }
        });
    });
    _fisheye.restoreData = null;
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
