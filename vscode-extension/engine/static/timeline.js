/**
 * timeline.js
 *
 * Timeline animation: progressively reveals the dependency graph in
 * topological layers so users can watch the architecture assemble itself.
 *
 * Design decisions for large codebases:
 *  - Plays **layer by layer**, not node by node.  Each layer is a batch of
 *    files at the same dependency depth, revealed together with their edges.
 *  - Pre-computes the full layout **once** at startup using the complete
 *    graph, then reveals nodes at their final positions.  No re-layout
 *    means nothing jumps around.
 *  - Freshly revealed nodes pulse bright, then settle.  Older layers dim
 *    slightly so you can always see what just changed.
 *  - A floating label shows the current layer number and the count of files
 *    in it, plus representative filenames, so viewers have context.
 *
 * Globals from state.js / graph-core.js:
 *   cy, currentGraphData, _runningLayout, getLayoutConfig,
 *   showToast, _escapeHtml, _compound
 */

// ============================================================
// Timeline state
// ============================================================

const _timeline = {
    active: false,
    playing: false,
    layers: [],       // [ { nodes: [id, ...], edges: [{source, target, classes}, ...] }, ... ]
    layerOf: {},      // nodeId → layer index
    cursor: 0,        // current layer being shown (0 = nothing, 1 = layer 0 visible, etc.)
    speed: 1,
    intervalId: null,
    positions: {},    // nodeId → { x, y } pre-computed
    tickMs: 1400,     // base ms between layer reveals
};

// ============================================================
// Topological layer computation
// ============================================================

function _tlComputeLayers(data) {
    const nodes = data.nodes || [];
    const edges = data.edges || [];
    if (!nodes.length) return { layers: [], layerOf: {} };

    const nodeIds = new Set();
    const outAdj = {};
    const revAdj = {};
    nodes.forEach(n => { const id = n.data.id; nodeIds.add(id); outAdj[id] = []; revAdj[id] = []; });
    edges.forEach(e => {
        const s = e.data.source, t = e.data.target;
        if (nodeIds.has(s) && nodeIds.has(t)) {
            outAdj[s].push(t);
            revAdj[t].push(s);
        }
    });

    // outDegree = how many internal files this file imports
    const outDeg = {};
    nodeIds.forEach(id => { outDeg[id] = outAdj[id].length; });

    // Kahn-style layered peel: layer 0 = leaves (import nothing)
    const layerOf = {};
    let currentQueue = [];
    nodeIds.forEach(id => { if (outDeg[id] === 0) currentQueue.push(id); });
    currentQueue.sort();
    const visited = new Set(currentQueue);
    let layerIdx = 0;

    const layers = [];
    while (currentQueue.length > 0) {
        currentQueue.forEach(id => { layerOf[id] = layerIdx; });
        layers.push({ nodes: currentQueue.slice(), edges: [] });

        const nextQueue = [];
        currentQueue.forEach(id => {
            (revAdj[id] || []).forEach(dep => {
                if (visited.has(dep)) return;
                outDeg[dep]--;
                if (outDeg[dep] <= 0) { visited.add(dep); nextQueue.push(dep); }
            });
        });
        layerIdx++;
        nextQueue.sort();
        currentQueue = nextQueue;
    }

    // Remaining nodes (in cycles) go into one final layer
    const remaining = [];
    nodeIds.forEach(id => { if (layerOf[id] === undefined) { layerOf[id] = layerIdx; remaining.push(id); } });
    if (remaining.length) {
        remaining.sort();
        layers.push({ nodes: remaining, edges: [] });
    }

    // Assign edges to the layer where both endpoints are first visible
    const visibleAfterLayer = {};  // nodeId → layer index
    layers.forEach((layer, li) => { layer.nodes.forEach(id => { visibleAfterLayer[id] = li; }); });
    edges.forEach(e => {
        const s = e.data.source, t = e.data.target;
        if (visibleAfterLayer[s] === undefined || visibleAfterLayer[t] === undefined) return;
        const targetLayer = Math.max(visibleAfterLayer[s], visibleAfterLayer[t]);
        layers[targetLayer].edges.push({
            source: s,
            target: t,
            classes: e.classes || '',
            color: e.data.color || '#94a3b8',
        });
    });

    // --- Subdivide large layers ---
    // Target roughly 15–30 total steps for a good pace.  If we already
    // have enough layers, skip subdivision entirely.
    const MIN_TOTAL_STEPS = 12;
    const MAX_CHUNK = Math.max(8, Math.ceil(nodes.length / 25));  // adaptive cap per chunk

    const rawLayerCount = layers.length;
    if (rawLayerCount < MIN_TOTAL_STEPS) {
        const splitLayers = [];
        layers.forEach(layer => {
            if (layer.nodes.length <= MAX_CHUNK) {
                layer._topoLayer = splitLayers.length;
                splitLayers.push(layer);
                return;
            }
            // Split this layer into chunks, grouping by directory so
            // related files appear together
            const byDir = {};
            layer.nodes.forEach(id => {
                const dir = id.lastIndexOf('/') === -1 ? '.' : id.substring(0, id.lastIndexOf('/'));
                if (!byDir[dir]) byDir[dir] = [];
                byDir[dir].push(id);
            });
            // Flatten directory groups into ordered chunks
            const dirKeys = Object.keys(byDir).sort();
            let chunk = [];
            dirKeys.forEach(dir => {
                byDir[dir].forEach(id => {
                    chunk.push(id);
                    if (chunk.length >= MAX_CHUNK) {
                        splitLayers.push({ nodes: chunk, edges: [], _topoLayer: splitLayers.length });
                        chunk = [];
                    }
                });
            });
            if (chunk.length) {
                splitLayers.push({ nodes: chunk, edges: [], _topoLayer: splitLayers.length });
            }

            // Re-distribute this layer's edges to the sub-layer where both
            // endpoints are visible
            const subVis = {};  // nodeId → sub-layer index
            splitLayers.forEach((sl, si) => { sl.nodes.forEach(id => { if (!subVis[id]) subVis[id] = si; }); });
            layer.edges.forEach(e => {
                const si = Math.max(subVis[e.source] || 0, subVis[e.target] || 0);
                if (splitLayers[si]) splitLayers[si].edges.push(e);
            });
        });

        // Update layerOf to match the new split indices
        const newLayerOf = {};
        splitLayers.forEach((sl, si) => { sl.nodes.forEach(id => { newLayerOf[id] = si; }); });

        return { layers: splitLayers, layerOf: newLayerOf, rawLayerCount };
    }

    return { layers, layerOf, rawLayerCount };
}

// ============================================================
// Pre-compute positions using the full graph
// ============================================================

function _tlPrecomputePositions(data, callback) {
    // Create a temporary off-screen container to run layout
    const offscreen = document.createElement('div');
    offscreen.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:2000px;height:1500px;';
    document.body.appendChild(offscreen);

    const allNodes = data.nodes.map(n => ({
        group: 'nodes',
        data: { ...n.data, label: n.data.id },
    }));
    const allEdges = data.edges.map(e => ({
        group: 'edges',
        data: {
            id: e.data.source + '->' + e.data.target,
            source: e.data.source,
            target: e.data.target,
            color: e.data.color || '#94a3b8',
        },
        classes: e.classes || '',
    }));

    const tmpCy = cytoscape({
        container: offscreen,
        elements: [...allNodes, ...allEdges],
        style: [{ selector: 'node', style: { width: 40, height: 40 } }],
        layout: { name: 'preset' },
    });

    const config = getLayoutConfig();
    config.animate = false;
    config.fit = true;
    config.padding = 80;

    const layout = tmpCy.layout(config);
    layout.one('layoutstop', () => {
        const positions = {};
        tmpCy.nodes().forEach(n => { positions[n.id()] = { ...n.position() }; });
        tmpCy.destroy();
        offscreen.remove();
        callback(positions);
    });
    layout.run();
    // Safety timeout
    setTimeout(() => {
        if (offscreen.parentNode) {
            try { tmpCy.destroy(); } catch(e) {}
            offscreen.remove();
            // Fall back to random positions
            const positions = {};
            data.nodes.forEach(n => {
                positions[n.data.id] = { x: Math.random() * 1600, y: Math.random() * 1200 };
            });
            callback(positions);
        }
    }, 8000);
}

// ============================================================
// Layer label descriptions
// ============================================================

function _tlLayerDescription(layerIndex, layerData, totalLayers) {
    const count = layerData.nodes.length;
    const edgeCount = layerData.edges.length;

    // Use the raw topological layer count for role labelling, not the
    // subdivided step count, so labels stay meaningful.
    const rawTotal = _timeline.rawLayerCount || totalLayers;
    // Estimate which topological layer this step belongs to
    const topoIdx = layerData._topoLayer !== undefined
        ? layerData._topoLayer
        : Math.round(layerIndex / totalLayers * rawTotal);
    const topoPct = rawTotal > 1 ? (topoIdx / (rawTotal - 1)) : 0;

    let role;
    if (layerIndex === 0) {
        role = 'Foundation';
    } else if (layerIndex === totalLayers - 1) {
        role = 'Entry points';
    } else if (topoPct < 0.2) {
        role = 'Foundation';
    } else if (topoPct < 0.45) {
        role = 'Core modules';
    } else if (topoPct < 0.7) {
        role = 'Mid-level modules';
    } else {
        role = 'High-level modules';
    }

    // Sample filenames (up to 3)
    const samples = layerData.nodes.slice(0, 3).map(id => {
        const parts = id.split('/');
        return parts[parts.length - 1];
    });
    const sampleStr = samples.join(', ') + (count > 3 ? ', \u2026' : '');

    // Detect dominant directory for extra context
    const dirs = {};
    layerData.nodes.forEach(id => {
        const d = id.lastIndexOf('/') === -1 ? '.' : id.substring(0, id.lastIndexOf('/'));
        dirs[d] = (dirs[d] || 0) + 1;
    });
    let topDir = '';
    let topDirCount = 0;
    Object.entries(dirs).forEach(([d, c]) => { if (c > topDirCount) { topDir = d; topDirCount = c; } });
    const dirHint = topDirCount > 1 && topDir !== '.' ? '  \u00b7  mostly ' + topDir + '/' : '';

    return {
        title: 'Step ' + (layerIndex + 1) + '/' + totalLayers + ' — ' + role,
        detail: count + ' file' + (count !== 1 ? 's' : '') + ', ' + edgeCount + ' edge' + (edgeCount !== 1 ? 's' : '') + dirHint,
        samples: sampleStr,
    };
}

// ============================================================
// Animation control
// ============================================================

function timelineOpen() {
    if (!currentGraphData || !currentGraphData.nodes.length) {
        showToast('Generate a graph first');
        return;
    }
    if (_timeline.active) return;

    // Show loading state
    showToast('Preparing timeline...');
    const bar = document.getElementById('timelineBar');

    // Compute layers
    const { layers, layerOf, rawLayerCount } = _tlComputeLayers(currentGraphData);
    if (!layers.length) { showToast('No layers to animate'); return; }

    _timeline.layers = layers;
    _timeline.layerOf = layerOf;
    _timeline.rawLayerCount = rawLayerCount || layers.length;
    _timeline.cursor = 0;
    _timeline.playing = false;

    // Stop any running layout
    if (_runningLayout) { try { _runningLayout.stop(); } catch(e) {} _runningLayout = null; }

    // Pre-compute positions, then start
    _tlPrecomputePositions(currentGraphData, (positions) => {
        _timeline.positions = positions;
        _timeline.active = true;

        // Clear the live graph
        if (cy) cy.batch(() => cy.elements().remove());

        // Show UI
        if (bar) {
            bar.style.display = 'flex';
            _tlUpdateUI();
        }

        // Show the layer label
        _tlShowLabel(null);

        showToast('Timeline ready — ' + layers.length + ' layers. Press Play or step through.');
    });
}

function timelineClose() {
    if (!_timeline.active) return;
    _timeline.active = false;
    timelinePause();

    const bar = document.getElementById('timelineBar');
    if (bar) bar.style.display = 'none';
    _tlHideLabel();

    // Restore the full graph
    if (currentGraphData && cy) {
        renderGraph(currentGraphData);
    }
}

function timelineToggle() {
    if (_timeline.active) timelineClose();
    else timelineOpen();
}

function timelinePlay() {
    if (!_timeline.active) return;
    if (_timeline.cursor >= _timeline.layers.length) {
        // Restart
        _timeline.cursor = 0;
        if (cy) cy.batch(() => cy.elements().remove());
    }
    _timeline.playing = true;
    _tlUpdatePlayBtn();

    _tlTickOnce();  // Immediately show first layer
}

function _tlTickOnce() {
    if (!_timeline.active || !_timeline.playing) return;
    if (_timeline.cursor >= _timeline.layers.length) {
        timelinePause();
        _tlShowLabel({ title: 'Complete', detail: 'All layers revealed', samples: '' });
        return;
    }

    _tlRevealLayer(_timeline.cursor);
    _timeline.cursor++;
    _tlUpdateUI();

    // Schedule next tick
    const ms = Math.max(100, _timeline.tickMs / _timeline.speed);
    _timeline.intervalId = setTimeout(_tlTickOnce, ms);
}

function timelinePause() {
    _timeline.playing = false;
    if (_timeline.intervalId) { clearTimeout(_timeline.intervalId); _timeline.intervalId = null; }
    _tlUpdatePlayBtn();
}

function timelinePlayPause() {
    if (_timeline.playing) timelinePause();
    else timelinePlay();
}

function timelineStepForward() {
    if (!_timeline.active || _timeline.cursor >= _timeline.layers.length) return;
    timelinePause();
    _tlRevealLayer(_timeline.cursor);
    _timeline.cursor++;
    _tlUpdateUI();
}

function timelineStepBack() {
    if (!_timeline.active || _timeline.cursor <= 0) return;
    timelinePause();
    _timeline.cursor--;
    _tlHideLayer(_timeline.cursor);
    _tlUpdateUI();
    // Update dimming for the new "latest" layer
    if (_timeline.cursor > 0) {
        _tlDimOlderLayers(_timeline.cursor - 1);
    }
}

function timelineSeek(position) {
    if (!_timeline.active) return;
    timelinePause();
    const target = Math.max(0, Math.min(_timeline.layers.length, parseInt(position, 10)));

    if (target < _timeline.cursor) {
        // Rewind: rebuild from scratch
        if (cy) cy.batch(() => cy.elements().remove());
        _timeline.cursor = 0;
    }

    // Fast-forward to target
    cy.startBatch();
    while (_timeline.cursor < target) {
        _tlRevealLayerQuiet(_timeline.cursor);
        _timeline.cursor++;
    }
    cy.endBatch();

    // Apply dimming for final state
    if (target > 0) _tlDimOlderLayers(target - 1);

    _tlUpdateUI();
    if (cy && cy.nodes().length) cy.fit(60);

    // Show label for current layer
    if (target > 0 && target <= _timeline.layers.length) {
        const desc = _tlLayerDescription(target - 1, _timeline.layers[target - 1], _timeline.layers.length);
        _tlShowLabel(desc);
    }
}

function timelineSetSpeed(s) {
    _timeline.speed = parseFloat(s) || 1;
}

// ============================================================
// Layer reveal / hide
// ============================================================

function _tlRevealLayer(layerIndex) {
    const layer = _timeline.layers[layerIndex];
    if (!layer || !cy) return;

    // Dim all existing nodes to show the new layer stands out
    _tlDimOlderLayers(layerIndex);

    // Add nodes at their pre-computed positions
    cy.startBatch();
    layer.nodes.forEach(id => {
        if (cy.getElementById(id).length) return;
        const nd = currentGraphData.nodes.find(n => n.data.id === id);
        if (!nd) return;
        const pos = _timeline.positions[id] || { x: Math.random() * 800, y: Math.random() * 600 };
        cy.add({
            group: 'nodes',
            data: { ...nd.data, label: nd.data.id, _tlLayer: layerIndex },
            position: pos,
        });
    });

    layer.edges.forEach(e => {
        const edgeId = e.source + '->' + e.target;
        if (cy.getElementById(edgeId).length) return;
        cy.add({
            group: 'edges',
            data: { id: edgeId, source: e.source, target: e.target, color: e.color, _tlLayer: layerIndex },
            classes: e.classes || '',
        });
    });
    cy.endBatch();

    // Animate new elements in
    const newNodes = cy.nodes().filter(n => n.data('_tlLayer') === layerIndex);
    const newEdges = cy.edges().filter(e => e.data('_tlLayer') === layerIndex);
    newNodes.style({ opacity: 0 });
    newEdges.style({ opacity: 0 });
    newNodes.animate({ style: { opacity: 1 } }, { duration: 350 });
    newEdges.animate({ style: { opacity: 0.7 } }, { duration: 350 });

    // Fit to show everything
    cy.animate({ fit: { eles: cy.elements(), padding: 60 } }, { duration: 300 });

    // Show layer label
    const desc = _tlLayerDescription(layerIndex, layer, _timeline.layers.length);
    _tlShowLabel(desc);
}

/** Reveal a layer without animation (for seek/fast-forward) */
function _tlRevealLayerQuiet(layerIndex) {
    const layer = _timeline.layers[layerIndex];
    if (!layer || !cy) return;

    layer.nodes.forEach(id => {
        if (cy.getElementById(id).length) return;
        const nd = currentGraphData.nodes.find(n => n.data.id === id);
        if (!nd) return;
        const pos = _timeline.positions[id] || { x: Math.random() * 800, y: Math.random() * 600 };
        cy.add({
            group: 'nodes',
            data: { ...nd.data, label: nd.data.id, _tlLayer: layerIndex },
            position: pos,
        });
    });

    layer.edges.forEach(e => {
        const edgeId = e.source + '->' + e.target;
        if (cy.getElementById(edgeId).length) return;
        cy.add({
            group: 'edges',
            data: { id: edgeId, source: e.source, target: e.target, color: e.color, _tlLayer: layerIndex },
            classes: e.classes || '',
        });
    });
}

function _tlHideLayer(layerIndex) {
    if (!cy) return;
    // Remove all elements tagged with this layer
    const toRemove = cy.elements().filter(el => el.data('_tlLayer') === layerIndex);
    toRemove.remove();

    // Show label for previous layer if any
    if (layerIndex > 0) {
        const desc = _tlLayerDescription(layerIndex - 1, _timeline.layers[layerIndex - 1], _timeline.layers.length);
        _tlShowLabel(desc);
    } else {
        _tlShowLabel(null);
    }
}

function _tlDimOlderLayers(currentLayerIndex) {
    if (!cy) return;
    // Older layers get dimmed; the newest layer is full brightness
    cy.nodes().forEach(n => {
        const nl = n.data('_tlLayer');
        if (nl === undefined) return;
        if (nl < currentLayerIndex) {
            n.style('opacity', 0.35);
        } else {
            n.style('opacity', 1);
        }
    });
    cy.edges().forEach(e => {
        const el = e.data('_tlLayer');
        if (el === undefined) return;
        if (el < currentLayerIndex) {
            e.style('opacity', 0.15);
        } else {
            e.style('opacity', 0.7);
        }
    });
}

// ============================================================
// Layer label overlay
// ============================================================

function _tlShowLabel(desc) {
    let label = document.getElementById('tlLayerLabel');
    if (!label) {
        label = document.createElement('div');
        label.id = 'tlLayerLabel';
        label.className = 'tl-layer-label';
        const main = document.querySelector('.main');
        if (main) main.appendChild(label);
    }

    if (!desc) {
        label.style.opacity = '0';
        return;
    }

    label.innerHTML =
        '<div class="tl-label-title">' + _escapeHtml(desc.title) + '</div>' +
        '<div class="tl-label-detail">' + _escapeHtml(desc.detail) + '</div>' +
        '<div class="tl-label-samples">' + _escapeHtml(desc.samples) + '</div>';
    label.style.opacity = '1';
}

function _tlHideLabel() {
    const label = document.getElementById('tlLayerLabel');
    if (label) { label.style.opacity = '0'; }
}

// ============================================================
// UI updates
// ============================================================

function _tlUpdateUI() {
    const counter = document.getElementById('tlCounter');
    const scrubber = document.getElementById('tlScrubber');
    const total = _timeline.layers.length;
    const cur = _timeline.cursor;

    // Count nodes revealed so far
    let nodesRevealed = 0;
    for (let i = 0; i < cur; i++) {
        nodesRevealed += _timeline.layers[i].nodes.length;
    }
    const totalNodes = currentGraphData ? currentGraphData.nodes.length : 0;

    if (counter) counter.textContent = 'Layer ' + cur + '/' + total + '  \u00b7  ' + nodesRevealed + '/' + totalNodes + ' files';
    if (scrubber) {
        scrubber.max = total;
        scrubber.value = cur;
    }
    _tlUpdatePlayBtn();
}

function _tlSetSpeedBtn(btn, speed) {
    timelineSetSpeed(speed);
    const group = document.getElementById('tlSpeedGroup');
    if (group) {
        group.querySelectorAll('.tl-speed-btn').forEach(b => b.classList.remove('tl-speed-active'));
        btn.classList.add('tl-speed-active');
    }
}

function _tlUpdatePlayBtn() {
    const btn = document.getElementById('tlPlayBtn');
    if (!btn) return;
    if (_timeline.playing) {
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
        btn.title = 'Pause (P)';
    } else {
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
        btn.title = 'Play (P)';
    }
}
