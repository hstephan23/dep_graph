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

    _fetchWithTimeout('/api/simulate', {
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
    .catch(err => { _handleApiError(err, 'Simulation failed.'); resultsEl.innerHTML = ''; });
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

// ============================================================
// MERGE / SPLIT SIMULATION
// ============================================================

let simMergeMode = 'merge';  // 'merge' or 'split'
let simMergeNodes = [];      // node IDs to merge together
let simMergeTarget = '';     // which node survives the merge
let simSplitNode = '';       // node being split
let simSplitParts = [];      // [{id, outbound:[], inbound:[], depends_on:[]}]

function simSetMergeMode(mode) {
    simMergeMode = mode;
    document.getElementById('sim-merge-panel').style.display = mode === 'merge' ? '' : 'none';
    document.getElementById('sim-split-panel').style.display = mode === 'split' ? '' : 'none';
    var btns = document.querySelectorAll('.sim-ms-tab');
    btns.forEach(function(b) { b.classList.toggle('active', b.dataset.mode === mode); });
    simMSHighlight();
}

/* --- MERGE --- */

function simMergeAddNode() {
    var input = document.getElementById('simMergeNodeInput');
    var id = input ? input.value.trim() : '';
    if (!id) return;
    if (simMergeNodes.includes(id)) { showToast('Already in merge list'); return; }
    if (!currentGraphData || !currentGraphData.nodes.find(function(n) { return n.data.id === id; })) {
        showToast('Node not found in graph'); return;
    }
    simMergeNodes.push(id);
    if (!simMergeTarget) simMergeTarget = id;
    input.value = '';
    simMergeRender();
    simMSHighlight();
}

function simMergeRemoveNode(idx) {
    var removed = simMergeNodes.splice(idx, 1)[0];
    if (simMergeTarget === removed) simMergeTarget = simMergeNodes[0] || '';
    simMergeRender();
    simMSHighlight();
}

function simMergeSetTarget(id) {
    simMergeTarget = id;
    simMergeRender();
}

function simMergeRender() {
    var list = document.getElementById('sim-merge-list');
    if (!list) return;
    list.innerHTML = '';
    simMergeNodes.forEach(function(id, i) {
        var isTarget = id === simMergeTarget;
        var div = document.createElement('div');
        div.className = 'sim-item' + (isTarget ? ' sim-item-primary' : '');
        div.innerHTML = '<span class="sim-item-label">' + id + '</span>'
            + (isTarget ? '<span class="badge badge-blue" style="font-size:0.58rem;">keeps name</span>' : '<button class="sim-merge-target-btn" onclick="simMergeSetTarget(\'' + id.replace(/'/g, "\\'") + '\')" title="Make this the surviving file">&#x2B06;</button>')
            + '<button class="sim-item-remove" onclick="simMergeRemoveNode(' + i + ')" title="Remove">&times;</button>';
        list.appendChild(div);
    });

    // show preview text
    var preview = document.getElementById('sim-merge-preview');
    if (preview) {
        if (simMergeNodes.length >= 2) {
            var absorbed = simMergeNodes.filter(function(n) { return n !== simMergeTarget; });
            preview.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> '
                + absorbed.join(', ') + ' <span style="color:var(--text-muted);">→ absorbed into</span> ' + simMergeTarget;
            preview.style.display = '';
        } else {
            preview.style.display = 'none';
        }
    }
}

/* --- SPLIT --- */

function simSplitSetNode() {
    var input = document.getElementById('simSplitNodeInput');
    var id = input ? input.value.trim() : '';
    if (!id) return;
    if (!currentGraphData || !currentGraphData.nodes.find(function(n) { return n.data.id === id; })) {
        showToast('Node not found in graph'); return;
    }
    simSplitNode = id;
    input.value = '';

    // Gather edges for this node
    var outbound = [], inbound = [];
    currentGraphData.edges.forEach(function(e) {
        if (e.data.source === id) outbound.push(e.data.target);
        if (e.data.target === id) inbound.push(e.data.source);
    });

    // Default: 2 parts, first part gets all edges
    var ext = id.lastIndexOf('.') >= 0 ? id.substring(id.lastIndexOf('.')) : '';
    var base = id.lastIndexOf('.') >= 0 ? id.substring(0, id.lastIndexOf('.')) : id;
    simSplitParts = [
        { id: base + '_a' + ext, outbound: outbound.slice(), inbound: inbound.slice(), depends_on: [] },
        { id: base + '_b' + ext, outbound: [], inbound: [], depends_on: [] },
    ];

    simSplitRender();
    simMSHighlight();
}

function simSplitAddPart() {
    if (!simSplitNode) { showToast('Select a file to split first'); return; }
    var ext = simSplitNode.lastIndexOf('.') >= 0 ? simSplitNode.substring(simSplitNode.lastIndexOf('.')) : '';
    var base = simSplitNode.lastIndexOf('.') >= 0 ? simSplitNode.substring(0, simSplitNode.lastIndexOf('.')) : simSplitNode;
    var letter = String.fromCharCode(97 + simSplitParts.length); // a, b, c, ...
    simSplitParts.push({ id: base + '_' + letter + ext, outbound: [], inbound: [], depends_on: [] });
    simSplitRender();
}

function simSplitRemovePart(idx) {
    if (simSplitParts.length <= 2) { showToast('Need at least 2 parts'); return; }
    simSplitParts.splice(idx, 1);
    simSplitRender();
}

function simSplitToggleEdge(partIdx, direction, target) {
    var part = simSplitParts[partIdx];
    var arr = part[direction];
    var idx = arr.indexOf(target);
    if (idx >= 0) {
        arr.splice(idx, 1);
    } else {
        arr.push(target);
    }
    simSplitRender();
}

function simSplitToggleInterPart(partIdx, otherPartId) {
    var part = simSplitParts[partIdx];
    if (!part.depends_on) part.depends_on = [];
    var idx = part.depends_on.indexOf(otherPartId);
    if (idx >= 0) {
        part.depends_on.splice(idx, 1);
    } else {
        part.depends_on.push(otherPartId);
    }
    simSplitRender();
}

function simSplitRender() {
    var container = document.getElementById('sim-split-parts');
    if (!container) return;

    if (!simSplitNode) {
        container.innerHTML = '<div class="panel-hint">Select a file to split first.</div>';
        return;
    }

    // Gather all edges of original node
    var allOutbound = [], allInbound = [];
    if (currentGraphData) {
        currentGraphData.edges.forEach(function(e) {
            if (e.data.source === simSplitNode) allOutbound.push(e.data.target);
            if (e.data.target === simSplitNode) allInbound.push(e.data.source);
        });
    }

    var html = '<div class="sim-split-original">'
        + '<span class="sim-section-label" style="margin:0;">Splitting: ' + simSplitNode + '</span>'
        + '<div style="font-size:0.65rem;color:var(--text-muted);margin-top:0.2rem;">'
        + allOutbound.length + ' outbound, ' + allInbound.length + ' inbound dependencies'
        + '</div></div>';

    simSplitParts.forEach(function(part, pi) {
        html += '<div class="sim-split-part-card">'
            + '<div class="sim-split-part-header">'
            + '<input type="text" class="sim-split-part-name" value="' + part.id.replace(/"/g, '&quot;') + '" '
            + 'onchange="simSplitParts[' + pi + '].id=this.value.trim()" placeholder="Part name">'
            + (simSplitParts.length > 2 ? '<button class="sim-item-remove" onclick="simSplitRemovePart(' + pi + ')" title="Remove part">&times;</button>' : '')
            + '</div>';

        // Outbound edges
        if (allOutbound.length > 0) {
            html += '<div class="sim-split-edge-group">'
                + '<div class="sim-split-edge-label">Imports (outbound):</div>';
            allOutbound.forEach(function(dep) {
                var checked = part.outbound.indexOf(dep) >= 0;
                html += '<label class="sim-split-edge-toggle' + (checked ? ' active' : '') + '">'
                    + '<input type="checkbox"' + (checked ? ' checked' : '') + ' onchange="simSplitToggleEdge(' + pi + ',\'outbound\',\'' + dep.replace(/'/g, "\\'") + '\')">'
                    + '<span>' + dep + '</span></label>';
            });
            html += '</div>';
        }

        // Inbound edges
        if (allInbound.length > 0) {
            html += '<div class="sim-split-edge-group">'
                + '<div class="sim-split-edge-label">Imported by (inbound):</div>';
            allInbound.forEach(function(imp) {
                var checked = part.inbound.indexOf(imp) >= 0;
                html += '<label class="sim-split-edge-toggle' + (checked ? ' active' : '') + '">'
                    + '<input type="checkbox"' + (checked ? ' checked' : '') + ' onchange="simSplitToggleEdge(' + pi + ',\'inbound\',\'' + imp.replace(/'/g, "\\'") + '\')">'
                    + '<span>' + imp + '</span></label>';
            });
            html += '</div>';
        }

        // Inter-part dependencies
        var otherParts = simSplitParts.filter(function(_, oi) { return oi !== pi; });
        if (otherParts.length > 0) {
            html += '<div class="sim-split-edge-group">'
                + '<div class="sim-split-edge-label">Depends on part:</div>';
            otherParts.forEach(function(op) {
                var checked = (part.depends_on || []).indexOf(op.id) >= 0;
                html += '<label class="sim-split-edge-toggle inter-part' + (checked ? ' active' : '') + '">'
                    + '<input type="checkbox"' + (checked ? ' checked' : '') + ' onchange="simSplitToggleInterPart(' + pi + ',\'' + op.id.replace(/'/g, "\\'") + '\')">'
                    + '<span>' + op.id + '</span></label>';
            });
            html += '</div>';
        }

        html += '</div>';
    });

    html += '<button class="btn btn-ghost" onclick="simSplitAddPart()" style="padding:0.3rem 0.5rem;font-size:0.7rem;margin-top:0.35rem;">+ Add Part</button>';

    container.innerHTML = html;
}

/* --- Run & Results --- */

function runMergeSimulation() {
    if (!currentGraphData) { showToast('Generate a graph first'); return; }

    var payload = { graph: currentGraphData };

    if (simMergeMode === 'merge') {
        if (simMergeNodes.length < 2) { showToast('Add at least 2 files to merge'); return; }
        payload.merge = [{ nodes: simMergeNodes, merged_id: simMergeTarget }];
    } else {
        if (!simSplitNode || simSplitParts.length < 2) { showToast('Set up a split first'); return; }
        payload.split = [{ node: simSplitNode, into: simSplitParts }];
    }

    var resultsEl = document.getElementById('sim-ms-results');
    resultsEl.innerHTML = '<div class="panel-hint" style="opacity:0.6;">Running simulation...</div>';

    _fetchWithTimeout('/api/simulate-merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._csrfHeaders() },
        body: JSON.stringify(payload),
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.error) { showToast('Error: ' + data.error); resultsEl.innerHTML = ''; return; }
        renderMergeSimResults(data);
        highlightMergeSimResults(data);
        showToast('Simulation complete');
    })
    .catch(function(err) { _handleApiError(err, 'Merge/split simulation failed.'); resultsEl.innerHTML = ''; });
}

function renderMergeSimResults(data) {
    var el = document.getElementById('sim-ms-results');
    var s = data.stats;
    var html = '';

    // Operation summary
    html += '<div class="node-card" style="margin-top:0.75rem;">'
        + '<div class="node-card-header">' + (s.operation === 'merge' ? 'Merge' : 'Split') + ' Results</div>';

    if (data.merge_descriptions && data.merge_descriptions.length > 0) {
        data.merge_descriptions.forEach(function(m) {
            html += '<div class="metric-row"><span class="metric-label">Merged into</span><span class="badge badge-blue">' + m.merged_into + '</span></div>';
            html += '<div class="metric-row"><span class="metric-label">Absorbed</span><span class="metric-value">' + m.absorbed.join(', ') + '</span></div>';
        });
    }
    if (data.split_descriptions && data.split_descriptions.length > 0) {
        data.split_descriptions.forEach(function(sp) {
            html += '<div class="metric-row"><span class="metric-label">Split from</span><span class="badge badge-purple">' + sp.original + '</span></div>';
            html += '<div class="metric-row"><span class="metric-label">Into parts</span><span class="metric-value">' + sp.parts.join(', ') + '</span></div>';
        });
    }

    html += '<div class="metric-row"><span class="metric-label">Graph</span><span class="metric-value">' + s.original_node_count + ' → ' + s.new_node_count + ' nodes, ' + s.original_edge_count + ' → ' + s.new_edge_count + ' edges</span></div>';

    var severity = s.broken_import_count > 5 ? 'badge-red' : s.broken_import_count > 0 ? 'badge-yellow' : 'badge-green';
    html += '<div class="metric-row"><span class="metric-label">Broken imports</span><span class="badge ' + severity + '">' + s.broken_import_count + '</span></div>';
    html += '<div class="metric-row"><span class="metric-label">Newly orphaned</span><span class="badge ' + (s.orphaned_count > 0 ? 'badge-yellow' : 'badge-green') + '">' + s.orphaned_count + '</span></div>';
    html += '<div class="metric-row"><span class="metric-label">Cycles resolved</span><span class="badge ' + (s.cycles_resolved > 0 ? 'badge-green' : '') + '">' + s.cycles_resolved + '</span></div>';
    html += '<div class="metric-row"><span class="metric-label">Cycles introduced</span><span class="badge ' + (s.cycles_introduced > 0 ? 'badge-red' : 'badge-green') + '">' + s.cycles_introduced + '</span></div>';
    html += '</div>';

    // Broken imports
    if (data.broken_imports.length > 0) {
        html += '<div class="panel-header" style="margin-top:0.75rem;">Broken Imports <span class="count-badge">' + data.broken_imports.length + '</span></div>';
        data.broken_imports.forEach(function(b) {
            html += '<div class="metric-row sim-broken-row" style="cursor:pointer;" onclick="simZoomTo(\'' + b.file.replace(/'/g, "\\'") + '\')">'
                + '<span class="metric-label"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> ' + b.file + '</span>'
                + '<span class="badge badge-red" style="font-size:0.6rem;">' + b.reason + '</span></div>';
            html += '<div class="sim-broken-detail">→ can\'t import <strong>' + b.missing_dep + '</strong></div>';
        });
    }

    // Orphaned
    if (data.newly_orphaned.length > 0) {
        html += '<div class="panel-header" style="margin-top:0.75rem;">Newly Orphaned <span class="count-badge">' + data.newly_orphaned.length + '</span></div>';
        data.newly_orphaned.forEach(function(id) {
            html += '<div class="metric-row clickable" onclick="simZoomTo(\'' + id.replace(/'/g, "\\'") + '\')" style="cursor:pointer;">'
                + '<span class="metric-label">' + id + '</span><span class="badge badge-yellow">orphaned</span></div>';
        });
    }

    // Cycles
    if (data.resolved_cycles.length > 0) {
        html += '<div class="panel-header" style="margin-top:0.75rem;">Cycles Resolved <span class="count-badge" style="background:#22c55e;color:#fff;">' + data.resolved_cycles.length + '</span></div>';
        data.resolved_cycles.forEach(function(cycle) {
            html += '<div class="cycle-card" style="border-left-color:#22c55e;"><div class="cycle-card-title" style="color:#22c55e;">✓ Resolved · ' + cycle.length + ' files</div>';
            cycle.forEach(function(nid) { html += '<div class="cycle-card-node">' + nid + '</div>'; });
            html += '</div>';
        });
    }
    if (data.new_cycles.length > 0) {
        html += '<div class="panel-header" style="margin-top:0.75rem;">New Cycles <span class="count-badge" style="background:#ef4444;color:#fff;">' + data.new_cycles.length + '</span></div>';
        data.new_cycles.forEach(function(cycle) {
            html += '<div class="cycle-card"><div class="cycle-card-title" style="color:#ef4444;">New cycle · ' + cycle.length + ' files</div>';
            cycle.forEach(function(nid) { html += '<div class="cycle-card-node">' + nid + '</div>'; });
            html += '</div>';
        });
    }

    // Impact changes
    if (data.impact_changes.length > 0) {
        html += '<div class="panel-header" style="margin-top:0.75rem;">Impact Changes <span class="count-badge">' + data.impact_changes.length + '</span></div>';
        data.impact_changes.slice(0, 15).forEach(function(c) {
            var arrow = c.delta > 0 ? '↑' : '↓';
            var cls = c.delta > 0 ? 'badge-red' : 'badge-green';
            html += '<div class="metric-row clickable" onclick="simZoomTo(\'' + c.file.replace(/'/g, "\\'") + '\')" style="cursor:pointer;">'
                + '<span class="metric-label">' + c.file + '</span>'
                + '<span class="badge ' + cls + '">' + arrow + ' ' + c.old_impact + ' → ' + c.new_impact + '</span></div>';
        });
    }

    // Clean result
    if (!data.broken_imports.length && !data.newly_orphaned.length && !data.new_cycles.length) {
        html += '<div class="panel-hint" style="margin-top:0.75rem;color:var(--success);">'
            + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle;margin-right:0.3rem;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
            + 'Clean ' + s.operation + ' — nothing breaks!</div>';
    }

    el.innerHTML = html;
}

function highlightMergeSimResults(data) {
    if (!cy) return;
    cy.elements().removeStyle();

    // Highlight merge targets
    if (data.merge_descriptions) {
        data.merge_descriptions.forEach(function(m) {
            var n = cy.getElementById(m.merged_into);
            if (n.length) n.style({ 'border-width': 4, 'border-color': '#3b82f6', 'border-style': 'solid' });
            m.absorbed.forEach(function(id) {
                var a = cy.getElementById(id);
                if (a.length) a.style({ opacity: 0.25, 'border-width': 4, 'border-color': '#3b82f6', 'border-style': 'dashed' });
            });
        });
    }

    // Highlight split source
    if (data.split_descriptions) {
        data.split_descriptions.forEach(function(sp) {
            var n = cy.getElementById(sp.original);
            if (n.length) n.style({ 'border-width': 4, 'border-color': '#a855f7', 'border-style': 'dashed', opacity: 0.4 });
        });
    }

    // Highlight broken/orphaned
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

function simMSHighlight() {
    if (!cy) return;
    cy.elements().removeStyle();
    pathHighlightActive = false;

    if (simMergeMode === 'merge') {
        simMergeNodes.forEach(function(id) {
            var n = cy.getElementById(id);
            if (n.length) {
                var isTarget = id === simMergeTarget;
                n.style({
                    'border-width': 4,
                    'border-color': '#3b82f6',
                    'border-style': isTarget ? 'solid' : 'dashed',
                    opacity: isTarget ? 1 : 0.5,
                });
            }
        });
    } else if (simSplitNode) {
        var n = cy.getElementById(simSplitNode);
        if (n.length) n.style({ 'border-width': 4, 'border-color': '#a855f7', 'border-style': 'dashed' });
    }
}

function simMSReset() {
    simMergeNodes = [];
    simMergeTarget = '';
    simSplitNode = '';
    simSplitParts = [];
    simMergeRender();
    simSplitRender();
    if (cy) cy.elements().removeStyle();
    pathHighlightActive = false;
    var r = document.getElementById('sim-ms-results');
    if (r) r.innerHTML = '';
}

// Hook: update sim datalist when graph loads
_postRenderHooks.push(function() { simUpdateDatalist(); });
