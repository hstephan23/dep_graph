/**
 * layers.js — Layered Architecture View
 *
 * Arranges nodes into horizontal swim-lanes by dependency depth.
 * Entry points (depth 0) sit at the top; deep leaf files at the bottom.
 * Files in the same directory cluster together within each layer.
 *
 * Edges that point "upward" (a deeper file importing a shallower one)
 * are flagged as architectural violations and drawn in red dashed style
 * with animated glow pulses so they're impossible to miss.
 *
 * For large repos the layout:
 *   - Wraps layers into a grid (multiple rows per depth level)
 *   - Reduces node sizes and hides labels at scale
 *   - Uses barycenter heuristic to reduce edge crossings
 *   - Fades non-violation edges to keep violations prominent
 *   - Draws alternating swim-lane backgrounds for visual clarity
 *
 * Dependencies:
 *   state.js  — cy, currentGraphData
 *   graph-core.js — _baseNodeStyle, _baseEdgeStyle, _normalStyles
 */

// ============================================================
// CONSTANTS
// ============================================================

const _VIOLATION_COLOR = '#f59e0b';
const _VIOLATION_GLOW  = '#fcd34d';

let _layersActive = false;
let _layerLabels  = [];
let _violationPulseTimer = null;

// User-defined layers: array of lowercase names (e.g. ['ui','service','data','util'])
// When set, overrides the auto-depth assignment.
let _userLayers = null;

// Per-file layer overrides: Map<fileId, rank>
// Set by clicking nodes in simulate mode. Takes priority over everything.
let _layerOverrides = new Map();

/** Match a filepath to a user-defined layer index.
 *  Checks each path segment against the user layer names.
 *  Returns { name, rank } or null if unmatched. */
function _userLayerOf(filepath) {
    if (!_userLayers || _userLayers.length === 0) return null;
    const parts = filepath.replace(/\\/g, '/').split('/');
    for (const part of parts) {
        const low = part.toLowerCase();
        const idx = _userLayers.indexOf(low);
        if (idx !== -1) return { name: _userLayers[idx], rank: idx };
    }
    return null;
}

/** Get effective layer rank for a node.
 *  Priority: per-file override > user-defined layer > auto depth.
 *  Unmatched files go to a catch-all layer at the bottom. */
function _effectiveRank(node) {
    // 1. Per-file override (from simulate clicks)
    if (_layerOverrides.has(node.id())) return _layerOverrides.get(node.id());
    // 2. User-defined layer names
    if (_userLayers && _userLayers.length > 0) {
        const match = _userLayerOf(node.id());
        return match ? match.rank : _userLayers.length;
    }
    // 3. Auto depth
    return node.data('depth') || 0;
}

/** Get the list of available layers (for the picker).
 *  Returns array of { rank, name }. */
function _getAvailableLayers() {
    if (_userLayers && _userLayers.length > 0) {
        const layers = _userLayers.map((name, i) => ({ rank: i, name }));
        layers.push({ rank: _userLayers.length, name: 'other' });
        return layers;
    }
    // Auto mode: collect all unique depths
    const depths = new Set();
    cy.nodes().forEach(n => depths.add(n.data('depth') || 0));
    return [...depths].sort((a, b) => a - b).map(d => ({ rank: d, name: 'L' + d }));
}

/** Apply user-defined layers and re-render the layers view. */
function applyUserLayers() {
    const input = document.getElementById('layerInput');
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) {
        // Clear user layers → revert to auto depth
        _userLayers = null;
    } else {
        _userLayers = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    }
    // Re-render if layers view is active
    if (_layersActive && cy) {
        // Clean up existing overlays
        cy.edges('.violation').removeClass('violation');
        cy.nodes('.violation-endpoint').removeClass('violation-endpoint');
        _clearLayerLabels();
        _clearLayerBands();
        _stopViolationPulse();
        // Re-run the full activation
        activateLayersView();
    }
}

// ============================================================
// SIMULATE — per-file layer reassignment
// ============================================================

/** Quick re-render of layers view (positions, violations, labels, sidebar). */
function _refreshLayers() {
    if (!_layersActive || !cy) return;
    cy.edges('.violation').removeClass('violation');
    cy.nodes('.violation-endpoint').removeClass('violation-endpoint');
    _clearLayerLabels();
    _clearLayerBands();
    _stopViolationPulse();

    const nodeCount = cy.nodes().length;
    const positions = _computeLayerPositions();
    if (!positions || Object.keys(positions).length === 0) return;

    _markViolationEdges();
    cy.style(_layerStyles(nodeCount));

    cy.batch(() => {
        cy.nodes().forEach(n => {
            const pos = positions[n.id()];
            if (pos) n.position(pos);
        });
    });
    cy.fit(60);

    _drawLayerBands(positions);
    _drawLayerLabels(positions);
    _startViolationPulse();
    _populateLayersSidebar();
}

/** Get the layer band Y-ranges from compound parent nodes (model-space). */
function _getLayerBandRanges() {
    if (!cy) return [];
    const ranges = [];
    cy.nodes('[?isLayerBand]').forEach(parent => {
        const rank = parent.data('layerRank');
        const bb = parent.boundingBox();
        if (bb && !isNaN(bb.y1) && !isNaN(bb.y2)) {
            ranges.push({ rank, minY: bb.y1, maxY: bb.y2 });
        }
    });
    return ranges.sort((a, b) => a.minY - b.minY);
}

/** Given a model-space Y coordinate, find which layer rank it falls in. */
function _rankAtY(modelY) {
    const ranges = _getLayerBandRanges();
    // Exact hit
    for (const r of ranges) {
        if (modelY >= r.minY && modelY <= r.maxY) return r.rank;
    }
    // Nearest band (for drops outside any band)
    let best = null, bestDist = Infinity;
    for (const r of ranges) {
        const mid = (r.minY + r.maxY) / 2;
        const dist = Math.abs(modelY - mid);
        if (dist < bestDist) { bestDist = dist; best = r.rank; }
    }
    return best;
}

let _dragStartRank = null;
let _draggedNode = null;
let _dragStartPos = null;
// Snapshot of band Y-ranges captured at drag start.  We freeze these so
// that Cytoscape's compound-parent bounding-box expansion (which follows
// the dragged child) doesn't corrupt hit-testing during the drag.
let _dragBandSnapshot = null;

/** Resolve a rank from the frozen snapshot taken at drag start. */
function _rankAtYFromSnapshot(modelY) {
    if (!_dragBandSnapshot || _dragBandSnapshot.length === 0) return _rankAtY(modelY);
    // Exact hit
    for (const r of _dragBandSnapshot) {
        if (modelY >= r.minY && modelY <= r.maxY) return r.rank;
    }
    // Nearest band (for drops outside any band)
    let best = null, bestDist = Infinity;
    for (const r of _dragBandSnapshot) {
        const mid = (r.minY + r.maxY) / 2;
        const dist = Math.abs(modelY - mid);
        if (dist < bestDist) { bestDist = dist; best = r.rank; }
    }
    return best;
}

/** On drop: determine which layer the node landed in and reassign. */
function _onDragFree(e) {
    if (!_layersActive || !cy) return;
    const node = e.target;
    if (node.data('isLayerBand')) return; // ignore band parents
    const dropY = node.position('y');
    const targetRank = _rankAtYFromSnapshot(dropY);

    // Clear drag highlight
    if (cy) cy.nodes('[?isLayerBand]').removeClass('layer-band-hover');
    _draggedNode = null;
    _dragBandSnapshot = null;

    // If barely moved (just a click), snap back
    if (_dragStartPos) {
        const dx = Math.abs(node.position('x') - _dragStartPos.x);
        const dy = Math.abs(node.position('y') - _dragStartPos.y);
        if (dx < 5 && dy < 5) {

            node.position(_dragStartPos);
            _refreshLayers();
            return;
        }
    }

    if (targetRank === null || targetRank === _dragStartRank) {

        _refreshLayers();
        return;
    }

    // Assign to new layer
    _layerOverrides.set(node.id(), targetRank);
    _refreshLayers();

    const layers = _getAvailableLayers();
    const layerName = layers.find(l => l.rank === targetRank);
    const shortName = node.id().length > 25 ? '…' + node.id().slice(-23) : node.id();
    showToast(`Moved ${shortName} → ${layerName ? layerName.name : 'L' + targetRank}`);
}

function _onDragStart(e) {
    if (!_layersActive) return;
    if (e.target.data('isLayerBand')) return; // ignore band parents
    _draggedNode = e.target;
    _dragStartRank = _effectiveRank(e.target);
    _dragStartPos = { x: e.target.position('x'), y: e.target.position('y') };

    // Freeze the current band Y-ranges BEFORE the drag moves anything.
    // Cytoscape compound parents auto-expand their bounding box to
    // follow dragged children, which would corrupt live hit-testing.
    // By snapshotting we use the original, stable geometry instead.
    _dragBandSnapshot = _getLayerBandRanges();
}

function _onDragging(e) {
    if (!_layersActive || !_draggedNode) return;
    const modelY = _draggedNode.position('y');
    const targetRank = _rankAtYFromSnapshot(modelY);
    // Highlight the band being hovered
    if (cy) cy.nodes('[?isLayerBand]').forEach(b => {
        const bandRank = b.data('layerRank');
        if (bandRank === targetRank && targetRank !== _dragStartRank) {
            b.addClass('layer-band-hover');
        } else {
            b.removeClass('layer-band-hover');
        }
    });
}

/** Assign a file to a specific layer rank. */
function _setFileLayer(fileId, rank) {
    _layerOverrides.set(fileId, rank);
    _refreshLayers();
}

/** Remove per-file override for a specific file. */
function _resetFileOverride(fileId) {
    _layerOverrides.delete(fileId);
    _refreshLayers();
}

/** Clear all per-file overrides. */
function resetAllLayerOverrides() {
    _layerOverrides.clear();
    _refreshLayers();
}

/** Install/remove drag-and-drop handler for layer simulation.
 *  NOTE: We avoid Cytoscape event namespaces (e.g. 'grab.layersim')
 *  because namespaced + delegated events are broken in Cytoscape ≤3.23.
 *  Instead we store function refs and remove them explicitly with cy.off(). */
function _installLayerClickHandler() {
    if (!cy) return;
    _removeLayerClickHandler();          // prevent double-registration
    cy.on('grab', 'node', _onDragStart);
    cy.on('drag', 'node', _onDragging);
    cy.on('free', 'node', _onDragFree);
}

function _removeLayerClickHandler() {
    if (cy) {
        cy.off('grab', 'node', _onDragStart);
        cy.off('drag', 'node', _onDragging);
        cy.off('free', 'node', _onDragFree);
    }
    _draggedNode = null;
    _dragStartRank = null;
    _dragBandSnapshot = null;
    if (cy) cy.nodes('[?isLayerBand]').removeClass('layer-band-hover');
}

// ============================================================
// ACTIVATE / DEACTIVATE
// ============================================================

function activateLayersView() {
    if (!cy || !currentGraphData) return;
    _layersActive = true;

    const nodeCount = cy.nodes().length;

    // 1. Compute layout positions
    const positions = _computeLayerPositions();
    if (!positions || Object.keys(positions).length === 0) return;

    // 2. Apply violation classes to edges
    _markViolationEdges();

    // 3. Apply custom styles
    cy.style(_layerStyles(nodeCount));

    // 4. Position nodes
    const cyContainer = document.getElementById('cy');
    const overlay = document.getElementById('loading');
    cyContainer.style.visibility = 'hidden';
    overlay.classList.add('active');

    cy.batch(() => {
        cy.nodes().forEach(n => {
            const pos = positions[n.id()];
            if (pos) n.position(pos);
        });
    });

    cy.fit(60);
    cyContainer.style.visibility = '';
    overlay.classList.remove('active');

    // 5. Draw swim-lane backgrounds, labels + stats
    _drawLayerBands(positions);
    _drawLayerLabels(positions);

    // 6. Start violation pulse animation
    _startViolationPulse();

    // 7. Populate sidebar panel + auto-open it
    _populateLayersSidebar();
    activatePanel(4);  // Layers panel is index 4

    // 8. Install per-file simulation click handler
    _installLayerClickHandler();

    showToast('Layout: Layers');
}

function deactivateLayersView() {
    _layersActive = false;
    _userLayers = null;
    _layerOverrides.clear();
    _removeLayerClickHandler();
    if (cy) {
        cy.edges('.violation').removeClass('violation');
        cy.nodes('.violation-endpoint').removeClass('violation-endpoint');
    }
    _clearLayerLabels();
    _clearLayerBands();
    _stopViolationPulse();
    _restoreLayersSidebar();
}

// ============================================================
// POSITION ALGORITHM
// ============================================================

function _computeLayerPositions() {
    const nodes = cy.nodes();
    if (nodes.length === 0) return {};

    const nodeCount = nodes.length;

    // --- Adaptive spacing based on node count ---
    // Increased gaps across the board for less cramping
    let nodeGap, groupGap, rowHeight, maxPerRow;
    if (nodeCount <= 30) {
        nodeGap = 120; groupGap = 90; rowHeight = 220; maxPerRow = 999;
    } else if (nodeCount <= 80) {
        nodeGap = 85; groupGap = 65; rowHeight = 185; maxPerRow = 16;
    } else if (nodeCount <= 200) {
        nodeGap = 60; groupGap = 45; rowHeight = 150; maxPerRow = 22;
    } else {
        nodeGap = 40; groupGap = 28; rowHeight = 110; maxPerRow = 30;
    }

    // --- Group nodes by effective layer rank ---
    const depthBuckets = {};
    let maxDepth = 0;
    nodes.forEach(n => {
        const depth = _effectiveRank(n);
        if (depth > maxDepth) maxDepth = depth;
        if (!depthBuckets[depth]) depthBuckets[depth] = [];
        depthBuckets[depth].push(n);
    });

    // --- Build adjacency for barycenter ordering ---
    const adjBelow = {};
    const adjAbove = {};
    cy.edges().forEach(e => {
        const sId = e.source().id(), tId = e.target().id();
        const sD = e.source().data('depth') || 0;
        const tD = e.target().data('depth') || 0;
        if (tD === sD + 1) {
            if (!adjBelow[sId]) adjBelow[sId] = [];
            adjBelow[sId].push(tId);
            if (!adjAbove[tId]) adjAbove[tId] = [];
            adjAbove[tId].push(sId);
        } else if (sD === tD + 1) {
            if (!adjBelow[tId]) adjBelow[tId] = [];
            adjBelow[tId].push(sId);
            if (!adjAbove[sId]) adjAbove[sId] = [];
            adjAbove[sId].push(tId);
        }
    });

    // --- Initial ordering: group by directory, alpha within ---
    for (let d = 0; d <= maxDepth; d++) {
        const bucket = depthBuckets[d] || [];
        bucket.sort((a, b) => {
            const dirA = _dirOf(a.id()), dirB = _dirOf(b.id());
            if (dirA !== dirB) return dirA.localeCompare(dirB);
            return a.id().localeCompare(b.id());
        });
    }

    // --- Barycenter passes (reduce crossings) ---
    const orderIndex = {};

    // Seed initial indices
    for (let d = 0; d <= maxDepth; d++) {
        (depthBuckets[d] || []).forEach((n, i) => { orderIndex[n.id()] = i; });
    }

    const passes = Math.min(4, maxDepth + 1);
    for (let pass = 0; pass < passes; pass++) {
        for (let d = 1; d <= maxDepth; d++) {
            _barycenterSort(depthBuckets[d] || [], adjAbove, orderIndex);
            (depthBuckets[d] || []).forEach((n, i) => { orderIndex[n.id()] = i; });
        }
        for (let d = maxDepth - 1; d >= 0; d--) {
            _barycenterSort(depthBuckets[d] || [], adjBelow, orderIndex);
            (depthBuckets[d] || []).forEach((n, i) => { orderIndex[n.id()] = i; });
        }
    }

    // --- Assign positions (with wrapping for wide layers) ---
    const positions = {};
    let yOffset = 100;

    for (let d = 0; d <= maxDepth; d++) {
        const bucket = depthBuckets[d] || [];
        if (bucket.length === 0) { yOffset += rowHeight; continue; }

        // Split into wrapped rows if this layer has too many nodes
        const rows = [];
        for (let i = 0; i < bucket.length; i += maxPerRow) {
            rows.push(bucket.slice(i, i + maxPerRow));
        }

        rows.forEach((row, ri) => {
            const y = yOffset + ri * (rowHeight * 0.55);
            let x = 0;
            let prevDir = null;

            row.forEach(n => {
                const dir = _dirOf(n.id());
                if (prevDir !== null && dir !== prevDir) x += groupGap;
                positions[n.id()] = { x, y };
                x += nodeGap;
                prevDir = dir;
            });

            // Center row
            const rowWidth = x - nodeGap;
            const shift = rowWidth / 2;
            row.forEach(n => { positions[n.id()].x -= shift; });
        });

        yOffset += rowHeight + (rows.length - 1) * (rowHeight * 0.55);
    }

    return positions;
}

/** Barycenter sort: reorder nodes by the average position of their
 *  neighbors in the reference layer. Keeps directory grouping as a
 *  tiebreaker so folders don't scatter. */
function _barycenterSort(bucket, adj, orderIndex) {
    if (bucket.length <= 1) return;

    bucket.sort((a, b) => {
        const bcA = _barycenter(a.id(), adj, orderIndex);
        const bcB = _barycenter(b.id(), adj, orderIndex);
        if (bcA === -1 && bcB === -1) {
            const dA = _dirOf(a.id()), dB = _dirOf(b.id());
            if (dA !== dB) return dA.localeCompare(dB);
            return a.id().localeCompare(b.id());
        }
        if (bcA === -1) return 1;
        if (bcB === -1) return -1;
        return bcA - bcB;
    });
}

function _barycenter(nodeId, adj, orderIndex) {
    const neighbors = adj[nodeId];
    if (!neighbors || neighbors.length === 0) return -1;
    let sum = 0;
    neighbors.forEach(nId => { sum += (orderIndex[nId] || 0); });
    return sum / neighbors.length;
}

function _dirOf(filepath) {
    const idx = filepath.lastIndexOf('/');
    return idx >= 0 ? filepath.substring(0, idx) : '.';
}

// ============================================================
// VIOLATION DETECTION
// ============================================================

function _markViolationEdges() {
    if (!cy) return;
    cy.edges().forEach(e => {
        const srcRank = _effectiveRank(e.source());
        const tgtRank = _effectiveRank(e.target());
        if (srcRank > tgtRank) {
            e.addClass('violation');
        } else {
            e.removeClass('violation');
        }
    });
}

// ============================================================
// VIOLATION PULSE ANIMATION
// ============================================================

function _startViolationPulse() {
    _stopViolationPulse();
    if (!cy) return;

    let bright = true;
    _violationPulseTimer = setInterval(() => {
        if (!_layersActive || !cy) { _stopViolationPulse(); return; }
        const violations = cy.edges('.violation');
        if (violations.length === 0) return;

        violations.style({
            'line-color': bright ? _VIOLATION_GLOW : _VIOLATION_COLOR,
            'target-arrow-color': bright ? _VIOLATION_GLOW : _VIOLATION_COLOR,
        });
        bright = !bright;
    }, 900);
}

function _stopViolationPulse() {
    if (_violationPulseTimer) {
        clearInterval(_violationPulseTimer);
        _violationPulseTimer = null;
    }
}

// ============================================================
// STYLES (scale-aware)
// ============================================================

function _layerStyles(nodeCount) {
    const base = _normalStyles();
    const isLarge = nodeCount > 60;
    const isHuge  = nodeCount > 150;

    // Uniform node size — layers view cares about position, not degree.
    // Override the default `data(size)` which scales by import count.
    const nodeSize = isHuge ? 22 : (isLarge ? 38 : 50);
    base.push({
        selector: 'node',
        style: {
            shape: 'round-rectangle',
            width: nodeSize,
            height: nodeSize,
            'font-size': isHuge ? '7px' : (isLarge ? '10px' : '12px'),
            'text-opacity': isHuge ? 0 : (isLarge ? 0.75 : 0.85),
        }
    });

    // All normal edges get significantly faded so violations pop
    base.push({
        selector: 'edge',
        style: {
            opacity: isHuge ? 0.08 : (isLarge ? 0.12 : 0.2),
            width: isHuge ? 0.8 : (isLarge ? 1.2 : 1.5),
            'arrow-scale': isHuge ? 0.4 : (isLarge ? 0.5 : 0.6),
        }
    });

    // Violation edges: thick, bright, dashed, high z-index
    base.push({
        selector: 'edge.violation',
        style: {
            'line-color': _VIOLATION_COLOR,
            'target-arrow-color': _VIOLATION_COLOR,
            'line-style': 'dashed',
            'line-dash-pattern': [10, 5],
            width: isLarge ? 1.5 : 2,
            opacity: 0.7,
            'arrow-scale': isLarge ? 0.6 : 0.7,
            'z-index': 999,
        }
    });

    // Source & target nodes of violations get a bright red ring
    base.push({
        selector: 'node.violation-endpoint',
        style: {
            'border-width': isLarge ? 2 : 2.5,
            'border-color': _VIOLATION_COLOR,
            'border-style': 'solid',
        }
    });

    // Cycle edges less prominent than violations in this view
    base.push({
        selector: 'edge.cycle',
        style: {
            opacity: isLarge ? 0.15 : 0.35,
        }
    });

    // Layer band parent nodes — rendered as rounded rectangles behind children
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    base.push({
        selector: 'node[?isLayerBand]',
        style: {
            'background-color': dark ? '#ffffff' : '#6366f1',
            'background-opacity': ele => (ele.data('bandColorIdx') === 0)
                ? (dark ? 0.03 : 0.03)
                : (dark ? 0.06 : 0.055),
            'border-width': 1,
            'border-color': dark ? 'rgba(255,255,255,0.08)' : 'rgba(99,102,241,0.12)',
            'border-style': 'solid',
            'border-opacity': 0.6,
            shape: 'round-rectangle',
            padding: '40px',
            label: '',
            'text-opacity': 0,
            'text-outline-color': 'transparent',
            'text-outline-width': 0,
            color: 'transparent',
            'min-width': '100px',
            'min-height': '40px',
            'z-index': 0,
            // Allow events to pass through to children — 'events':'no'
            // blocks hit-testing on child nodes in Cytoscape ≤3.23.
            // Instead we ungrabify/unselect the parents after creation.
            'events': 'yes',
        }
    });

    // Hover highlight when dragging a node over a different layer
    base.push({
        selector: 'node[?isLayerBand].layer-band-hover',
        style: {
            'background-opacity': dark ? 0.12 : 0.10,
            'border-width': 2,
            'border-opacity': 1,
        }
    });

    return base;
}

// ============================================================
// SWIM-LANE BACKGROUND BANDS  (Cytoscape compound parent nodes)
// ============================================================
// Instead of overlaying DOM elements or canvases, we add invisible
// compound parent nodes to Cytoscape for each layer.  Cytoscape
// renders them natively so zoom / pan / fit all just work.

let _layerParentIds = [];  // ids of parent nodes we added

function _drawLayerBands(positions) {
    _clearLayerBands();
    if (!cy) return;

    // Collect rank → list of node ids
    const rankBuckets = new Map();
    cy.nodes().forEach(n => {
        const rank = _effectiveRank(n);
        if (!rankBuckets.has(rank)) rankBuckets.set(rank, []);
        rankBuckets.get(rank).push(n.id());
    });

    // Mark violation endpoint nodes
    cy.edges('.violation').forEach(e => {
        e.source().addClass('violation-endpoint');
        e.target().addClass('violation-endpoint');
    });

    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const bandColors = dark
        ? ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.08)']
        : ['rgba(99,102,241,0.045)', 'rgba(99,102,241,0.09)'];
    const borderColors = dark
        ? ['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.10)']
        : ['rgba(99,102,241,0.10)', 'rgba(99,102,241,0.15)'];

    const sortedRanks = [...rankBuckets.keys()].sort((a, b) => a - b);

    // Add parent nodes and reparent real nodes inside a batch
    cy.batch(() => {
        sortedRanks.forEach((rank, idx) => {
            const parentId = '__layer_band_' + rank;
            _layerParentIds.push(parentId);

            // Determine label: user-defined name or "L0", "L1", etc.
            let layerLabel;
            if (_userLayers && _userLayers.length > 0) {
                layerLabel = rank < _userLayers.length ? _userLayers[rank] : 'other';
            } else {
                layerLabel = 'L' + rank;
            }
            const nodeCount = rankBuckets.get(rank).length;

            // Count violations originating from this layer
            let vCount = 0;
            cy.edges('.violation').forEach(e => {
                if (_effectiveRank(e.source()) === rank) vCount++;
            });

            cy.add({
                group: 'nodes',
                data: {
                    id: parentId,
                    isLayerBand: true,
                    layerRank: rank,
                    bandColorIdx: idx % 2,
                    bandBg: bandColors[idx % 2],
                    bandBorder: borderColors[idx % 2],
                    layerLabel: layerLabel,
                    layerNodeCount: nodeCount,
                    layerViolationCount: vCount,
                },
            });

            // Reparent each node in this layer
            rankBuckets.get(rank).forEach(nodeId => {
                cy.getElementById(nodeId).move({ parent: parentId });
            });
        });
    });

    // Prevent band parents from being grabbed/selected by the user
    // (we use ungrabify instead of 'events':'no' because the latter
    // blocks hit-testing on child nodes in Cytoscape ≤3.23).
    cy.nodes('[?isLayerBand]').ungrabify().unselectify();

    // Reapply positions (reparenting can shift them)
    cy.batch(() => {
        cy.nodes().forEach(n => {
            const pos = positions[n.id()];
            if (pos) n.position(pos);
        });
    });
}

function _clearLayerBands() {
    if (!cy) return;
    if (_layerParentIds.length > 0) {
        cy.batch(() => {
            // Unparent all children first
            _layerParentIds.forEach(pid => {
                const parent = cy.getElementById(pid);
                if (parent.length) {
                    parent.children().move({ parent: null });
                }
            });
            // Remove parent nodes
            cy.remove(cy.nodes().filter(n => n.data('isLayerBand')));
        });
        _layerParentIds = [];
    }
    cy.nodes('.violation-endpoint').removeClass('violation-endpoint');
}

// ============================================================
// SWIM-LANE LABELS + STATS  (DOM pills synced via cy render event)
// ============================================================
// Labels are DOM elements (pill badges) placed as direct children of
// the Cytoscape container.  On every Cytoscape render frame we read
// each band's renderedBoundingBox() and reposition the label to its
// top-left corner.  renderedBoundingBox() already accounts for zoom
// and pan and returns pixel coords relative to the container, so
// there is no manual transform math and zero drift.

function _drawLayerLabels(positions) {
    _clearLayerLabels();
    if (!cy) return;

    const container = cy.container();
    if (!container) return;

    // Count violations per layer
    const layerViolations = {};
    cy.edges('.violation').forEach(e => {
        const d = _effectiveRank(e.source());
        layerViolations[d] = (layerViolations[d] || 0) + 1;
    });

    // Create one DOM pill label per band
    _layerParentIds.forEach(pid => {
        const bandNode = cy.getElementById(pid);
        if (!bandNode || !bandNode.length) return;

        const rank = bandNode.data('layerRank');
        const count = bandNode.data('layerNodeCount') || 0;
        const vCount = layerViolations[rank] || 0;

        let layerName;
        if (_userLayers && _userLayers.length > 0) {
            layerName = rank < _userLayers.length ? _userLayers[rank] : 'other';
        } else {
            layerName = 'L' + rank;
        }

        const label = document.createElement('div');
        label.className = 'layer-swim-label';
        label.dataset.bandId = pid;

        let html =
            `<span class="layer-depth-num">${_escapeHtml(layerName)}</span>` +
            `<span class="layer-depth-count">${count} file${count !== 1 ? 's' : ''}</span>`;
        if (vCount > 0) {
            html += `<span class="layer-violation-badge">${vCount}</span>`;
        }
        label.innerHTML = html;
        container.appendChild(label);
        _layerLabels.push(label);
    });

    // Stats bar
    const violationCount = cy.edges('.violation').length;
    const totalEdges = cy.edges().length;
    const layerCount = _layerParentIds.length;
    const fileCount = cy.nodes('[!isLayerBand]').length;

    let stats = document.getElementById('layerStatsBar');
    if (!stats) {
        stats = document.createElement('div');
        stats.id = 'layerStatsBar';
        container.appendChild(stats);
    }

    const pct = totalEdges > 0 ? ((violationCount / totalEdges) * 100).toFixed(1) : '0';
    stats.innerHTML =
        `<span class="layer-stat">${layerCount} layers</span>` +
        `<span class="layer-stat-sep">&middot;</span>` +
        `<span class="layer-stat">${fileCount} files</span>` +
        `<span class="layer-stat-sep">&middot;</span>` +
        `<span class="layer-stat ${violationCount > 0 ? 'layer-stat-warn' : ''}">${violationCount} violation${violationCount !== 1 ? 's' : ''} (${pct}%)</span>`;

    // Initial sync + start rAF loop
    _syncLabelPositions();
    _startLabelLoop();
}

let _labelRafId = null;

function _labelLoop() {
    _syncLabelPositions();
    _labelRafId = requestAnimationFrame(_labelLoop);
}

function _startLabelLoop() {
    _stopLabelLoop();
    _labelRafId = requestAnimationFrame(_labelLoop);
}

function _stopLabelLoop() {
    if (_labelRafId !== null) {
        cancelAnimationFrame(_labelRafId);
        _labelRafId = null;
    }
}

function _syncLabelPositions() {
    if (!cy || _layerLabels.length === 0) return;

    _layerLabels.forEach(label => {
        const bandNode = cy.getElementById(label.dataset.bandId);
        if (!bandNode || !bandNode.length) { label.style.display = 'none'; return; }

        const bb = bandNode.renderedBoundingBox();
        label.style.display = '';
        label.style.left = (bb.x1 + 10) + 'px';
        label.style.top  = (bb.y1 + 8)  + 'px';
    });
}

function _clearLayerLabels() {
    _stopLabelLoop();
    _layerLabels.forEach(l => l.remove());
    _layerLabels = [];
    const stats = document.getElementById('layerStatsBar');
    if (stats) stats.remove();
}

// ============================================================
// SIDEBAR PANEL CONTENT
// ============================================================

let _layersSidebarOriginal = null;  // stashed original HTML

function _populateLayersSidebar() {
    if (!cy) return;

    const panel = document.getElementById('panel-layers');
    if (!panel) return;

    // Stash original content so we can restore on deactivate
    if (!_layersSidebarOriginal) {
        _layersSidebarOriginal = panel.innerHTML;
    }

    // Helper to get display name for a rank
    function _rankName(rank) {
        if (_userLayers && _userLayers.length > 0) {
            return rank < _userLayers.length ? _userLayers[rank] : 'other';
        }
        return 'L' + rank;
    }

    // --- Gather data ---
    const violations = [];
    cy.edges('.violation').forEach(e => {
        const srcRank = _effectiveRank(e.source());
        const tgtRank = _effectiveRank(e.target());
        violations.push({
            source: e.source().id(),
            target: e.target().id(),
            srcDepth: srcRank,
            tgtDepth: tgtRank,
            srcName: _rankName(srcRank),
            tgtName: _rankName(tgtRank),
        });
    });

    // Group violations by source file
    const bySource = {};
    violations.forEach(v => {
        if (!bySource[v.source]) bySource[v.source] = [];
        bySource[v.source].push(v);
    });

    // Count violations per file (as source or target)
    const fileCounts = {};
    violations.forEach(v => {
        fileCounts[v.source] = (fileCounts[v.source] || 0) + 1;
        fileCounts[v.target] = (fileCounts[v.target] || 0) + 1;
    });

    // Layer breakdown
    const layerInfo = {};
    cy.nodes().forEach(n => {
        const d = _effectiveRank(n);
        const dir = _dirOf(n.id());
        if (!layerInfo[d]) layerInfo[d] = { count: 0, dirs: {} };
        layerInfo[d].count++;
        layerInfo[d].dirs[dir] = (layerInfo[d].dirs[dir] || 0) + 1;
    });

    // --- Build HTML ---
    let html = '';

    // Header + layer input (preserved when sidebar re-renders)
    html += '<div class="panel-header">Architecture Layers</div>';
    html += '<div class="panel-hint">Define layers top-to-bottom. Imports going "upward" are flagged.</div>';
    const currentInput = _userLayers ? _userLayers.join(', ') : '';
    html += '<div class="action-row">';
    html += `<input type="text" id="layerInput" placeholder="ui, service, data, util" value="${_escapeHtml(currentInput)}" onkeydown="if(event.key===\'Enter\')applyUserLayers()">`;
    html += '<button class="btn btn-primary" onclick="applyUserLayers()" style="padding:0.4rem 0.65rem;font-size:0.75rem;">Apply</button>';
    html += '</div>';
    if (_userLayers && _userLayers.length > 0) {
        html += `<div class="panel-hint" style="font-size:0.68rem;opacity:0.7;margin-top:-0.2rem;">Showing user-defined layers. Clear input and apply to revert to auto-detection.</div>`;
    } else {
        html += `<div class="panel-hint" style="font-size:0.68rem;opacity:0.7;margin-top:-0.2rem;">Using auto-detection by dependency depth. Enter layer names to customize.</div>`;
    }

    // ---- Per-file overrides bar ----
    if (_layerOverrides.size > 0) {
        html += `<div class="layer-overrides-bar">`;
        html += `<span>${_layerOverrides.size} file${_layerOverrides.size > 1 ? 's' : ''} reassigned</span>`;
        html += `<button onclick="resetAllLayerOverrides()">Reset all</button>`;
        html += `</div>`;
    } else {
        html += `<div class="panel-hint" style="font-size:0.65rem;opacity:0.55;margin-top:0;">Drag a node to another layer to simulate reassignment.</div>`;
    }

    // ---- Violations section ----
    html += `<div class="panel-section-header">Violations <span class="count-badge${violations.length > 0 ? ' count-badge-red' : ''}">${violations.length}</span></div>`;

    if (violations.length === 0) {
        html += '<div class="panel-hint" style="color:var(--success);">No upward violations detected. Clean architecture!</div>';
    } else {
        html += '<div class="panel-hint">Imports pointing upward (deeper file → shallower layer).</div>';

        // Worst offenders
        const offenders = Object.entries(fileCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8);

        html += '<div class="panel-section-header" style="margin-top:0.6rem;">Worst Offenders</div>';
        offenders.forEach(([file, count]) => {
            const short = file.length > 35 ? '…' + file.slice(-33) : file;
            html += `<div class="metric-row clickable" onclick="_layersSidebarZoom('${_escapeHtml(file)}')" title="${_escapeHtml(file)}">` +
                `<span class="metric-label">${_escapeHtml(short)}</span>` +
                `<span class="badge badge-red">${count}</span>` +
                `</div>`;
        });

        // Violation list grouped by source
        html += '<div class="panel-section-header" style="margin-top:0.6rem;">All Violations</div>';
        const sourceFiles = Object.keys(bySource).sort((a, b) =>
            bySource[b].length - bySource[a].length
        );

        sourceFiles.forEach(src => {
            const items = bySource[src];
            const shortSrc = src.length > 30 ? '…' + src.slice(-28) : src;
            html += `<div class="layers-violation-group">`;
            html += `<div class="layers-violation-src clickable" onclick="_layersSidebarZoom('${_escapeHtml(src)}')" title="${_escapeHtml(src)}">` +
                `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>` +
                `<span>${_escapeHtml(shortSrc)}</span>` +
                `<span class="badge badge-red">${items.length}</span>` +
                `</div>`;

            items.forEach(v => {
                const shortTgt = v.target.length > 28 ? '…' + v.target.slice(-26) : v.target;
                html += `<div class="layers-violation-edge clickable" onclick="_layersSidebarZoom('${_escapeHtml(v.target)}')" title="${_escapeHtml(v.target)}">` +
                    `→ ${_escapeHtml(shortTgt)} ` +
                    `<span style="opacity:0.5;font-size:0.65rem;">${_escapeHtml(v.srcName)} → ${_escapeHtml(v.tgtName)}</span>` +
                    `</div>`;
            });
            html += `</div>`;
        });
    }

    // ---- Layer breakdown ----
    html += '<div class="panel-section-header" style="margin-top:0.8rem;">Layer Breakdown</div>';
    const depths = Object.keys(layerInfo).map(Number).sort((a, b) => a - b);
    depths.forEach(d => {
        const info = layerInfo[d];
        const dirs = Object.entries(info.dirs).sort((a, b) => b[1] - a[1]);
        const topDirs = dirs.slice(0, 3).map(([dir, c]) => {
            const short = dir === '.' ? '(root)' : (dir.length > 15 ? '…' + dir.slice(-13) : dir);
            return short + (c > 1 ? ' (' + c + ')' : '');
        }).join(', ');
        const extra = dirs.length > 3 ? ` +${dirs.length - 3} more` : '';

        const layerDisplayName = _rankName(d);
        html += `<div class="metric-row">` +
            `<span class="metric-label"><strong>${_escapeHtml(layerDisplayName)}</strong> &nbsp;${_escapeHtml(topDirs)}${extra}</span>` +
            `<span class="metric-value">${info.count}</span>` +
            `</div>`;
    });

    panel.innerHTML = html;
}

function _restoreLayersSidebar() {
    const panel = document.getElementById('panel-layers');
    if (panel && _layersSidebarOriginal) {
        panel.innerHTML = _layersSidebarOriginal;
        _layersSidebarOriginal = null;
    }
}

/** Zoom to a file node from the sidebar — used by onclick handlers */
function _layersSidebarZoom(fileId) {
    if (!cy) return;
    const node = cy.getElementById(fileId);
    if (node && node.length) {
        cy.animate({
            center: { eles: node },
            zoom: Math.max(cy.zoom(), 1.5)
        }, { duration: 400 });
        // Flash highlight
        node.style({ 'border-width': 5, 'border-color': '#facc15', 'border-style': 'solid' });
        setTimeout(() => {
            if (_layersActive) {
                const isEndpoint = node.hasClass('violation-endpoint');
                node.style({
                    'border-width': isEndpoint ? 3 : 0,
                    'border-color': isEndpoint ? _VIOLATION_COLOR : 'transparent',
                });
            } else {
                node.style({ 'border-width': 0, 'border-color': 'transparent' });
            }
        }, 1500);
    }
}
