// ============================================================
// REFACTOR SIMULATION
// This module provides the refactor simulation feature for
// testing the impact of removing nodes and edges from the
// dependency graph. All globals from state.js are available.
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
_postRenderHooks.push(function() { simUpdateDatalist(); });
