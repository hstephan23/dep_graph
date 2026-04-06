/**
 * graph-core.js
 *
 * Core graph functionality for dependency visualization:
 * - Compound node helpers and directory management
 * - Cytoscape style definitions (normal and compound modes)
 * - Element building from graph data
 * - Cytoscape initialization and event binding
 * - Compound mode API (expand/collapse/toggle)
 * - Layout configuration
 *
 * All globals (cy, currentGraphData, _compound, _COMPOUND_PALETTE, COMPOUND_THRESHOLD,
 * _runningLayout, etc.) are available from state.js which loads first.
 */

// --- Register Cytoscape extensions ---
// cytoscape-dagre may auto-register, but we call use() explicitly to be safe.
// The UMD build exposes window.cytoscapeDagre.
if (typeof cytoscapeDagre === 'function') {
    try { cytoscape.use(cytoscapeDagre); } catch (_) { /* already registered */ }
} else if (typeof window !== 'undefined' && typeof window.cytoscapeDagre === 'function') {
    try { cytoscape.use(window.cytoscapeDagre); } catch (_) { /* already registered */ }
}

// --- Helpers ---

function _cDir(fileId) {
    const i = fileId.lastIndexOf('/');
    return i === -1 ? '.' : fileId.substring(0, i);
}

/** Get all ancestor directories for a path, e.g. "a/b/c" → ["a", "a/b", "a/b/c"] */
function _cAncestors(dirId) {
    if (dirId === '.') return ['.'];
    const parts = dirId.split('/');
    const result = [];
    for (let i = 1; i <= parts.length; i++) result.push(parts.slice(0, i).join('/'));
    return result;
}

// _COMPOUND_PALETTE is defined in state.js

function _cColor(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
    return _COMPOUND_PALETTE[Math.abs(h) % _COMPOUND_PALETTE.length];
}

// --- Shared Cytoscape style definitions ---

function _baseNodeStyle() {
    return {
        width: 'data(size)', height: 'data(size)',
        'background-color': 'data(color)', label: 'data(label)',
        color: '#fff', 'text-outline-color': 'data(color)', 'text-outline-width': 2,
        'font-size': ele => Math.max(14, Math.min(36, (ele.data('size') || 80) / 8)) + 'px',
        'text-valign': 'center', 'text-halign': 'center',
    };
}

function _baseEdgeStyle() {
    return {
        width: ele => {
            const w = ele.data('weight') || 1;
            return 2.5 + w * 1.5;  // 4px (weight 1) to 10px (weight 5)
        },
        'line-color': ele => {
            const w = ele.data('weight') || 1;
            // Blend from light gray to darker blue-gray as weight increases
            const t = (w - 1) / 4;  // 0..1
            const r = Math.round(148 - t * 50);
            const g = Math.round(163 - t * 55);
            const b = Math.round(184 - t * 30);
            return `rgb(${r},${g},${b})`;
        },
        'target-arrow-color': ele => {
            const w = ele.data('weight') || 1;
            const t = (w - 1) / 4;
            const r = Math.round(148 - t * 50);
            const g = Math.round(163 - t * 55);
            const b = Math.round(184 - t * 30);
            return `rgb(${r},${g},${b})`;
        },
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        opacity: ele => {
            const w = ele.data('weight') || 1;
            return 0.4 + (w - 1) * 0.15;  // 0.4 (weight 1) to 1.0 (weight 5)
        },
    };
}

function _cycleEdgeStyle() {
    return { 'line-color': '#FF4136', 'target-arrow-color': '#FF4136', width: 3, opacity: 1 };
}

function _normalStyles() {
    return [
        { selector: 'node', style: _baseNodeStyle() },
        { selector: 'edge', style: _baseEdgeStyle() },
        { selector: 'edge.cycle', style: _cycleEdgeStyle() },
    ];
}

/** Theme-aware helper — returns values for light/dark mode */
function _cTheme() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
        dark,
        containerBg: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
        labelOutline: dark ? '#0e1019' : '#f1f5f9',
        labelColor: dark ? '#a1a7be' : '#475569',
        edgeLabelOutline: dark ? '#0e1019' : '#ffffff',
        badgeBg: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    };
}

/** Compound styles — REMOVED (directory graph view disabled).
 *  Kept as no-op stub so any stale callers don't crash. */
function _compoundStyles() { return _normalStyles(); }

/* ---- REMOVED compound helper code ----
 * The following functions were part of the directory compound graph view
 * which has been removed. Stubs are kept below (after _cInitCy) so that
 * any lingering callers get safe no-ops instead of ReferenceErrors.
 * ---- END REMOVED ---- */

// (compound element building code removed)

// _cBuildElements — removed (compound view disabled)

// --- Cytoscape init ---

// _cAutoFit — kept as a no-op for any stale callers
function _cAutoFit() {}

/**
 * Initialise or hot-swap the Cytoscape graph.
 *
 * When `cy` already exists we reuse the same instance — swap elements +
 * styles in a single batch, then run the new layout.  This avoids the
 * destroy → blank → recreate stutter that plagued view switches.
 *
 * A full destroy/create only happens on the very first call (or if the
 * container was removed from the DOM, which shouldn't normally happen).
 */
function _cInitCy(elements, styles) {
    // 1. Stop any in-flight layout
    if (_runningLayout) { try { _runningLayout.stop(); } catch(e) {} _runningLayout = null; }

    const cyContainer = document.getElementById('cy');
    const overlay     = document.getElementById('loading');
    const needsCreate = !cy || cy.destroyed() || !cy.container() || !document.contains(cy.container());

    if (needsCreate) {
        // ── First-time creation (or recovery) ───────────────────────
        if (cy) { try { cy.destroy(); } catch(e) {} }
        cyContainer.style.visibility = 'hidden';
        overlay.classList.add('active');

        cy = cytoscape({
            container: cyContainer,
            elements: elements,
            style: styles,
            layout: { name: 'preset' },
            minZoom: 0.08,
            maxZoom: 4,
            wheelSensitivity: 0.25,
        });
        attachMinimapListeners();
    } else {
        // ── Hot-swap: reuse the existing cy instance ────────────────
        // Fade the canvas slightly so the brief layout frame isn't jarring
        cyContainer.style.opacity = '0';
        cyContainer.style.transition = 'opacity 0.12s ease-out';

        cy.batch(() => {
            cy.elements().remove();
            cy.add(elements);
        });
        cy.style(styles);
    }

    // 2. Run layout, then reveal
    const layoutCfg  = { ...getLayoutConfig(), fit: true, animate: false };
    _runningLayout   = cy.layout(layoutCfg);

    let revealed = false;
    const reveal = () => {
        if (revealed) return;
        revealed = true;
        _runningLayout = null;
        if (!cy) return;
        cy.fit(120);

        if (needsCreate) {
            cyContainer.style.visibility = '';
            overlay.classList.remove('active');
        } else {
            // Fade back in
            cyContainer.style.opacity = '1';
            // Clean up the transition style after it completes
            setTimeout(() => { cyContainer.style.transition = ''; }, 150);
        }
    };
    _runningLayout.one('layoutstop', reveal);
    setTimeout(reveal, 3000);           // safety fallback
    _runningLayout.run();
}

function _cBindNormalHandlers() {
    // Remove only interaction events (not layout events like layoutstop)
    cy.off('tap dbltap mouseover mouseout');
    cy.on('tap', 'node', evt => {
        if (typeof _layersActive !== 'undefined' && _layersActive) return; // skip in layers view
        clearPathHighlight(); highlightPaths(evt.target.id()); showBlastRadius(evt.target.id()); setTreeRoot(evt.target.id());
    });
    cy.on('dbltap', 'node', evt => openPreview(evt.target.id()));
    cy.on('tap', evt => { if (evt.target === cy && !(typeof _layersActive !== 'undefined' && _layersActive)) clearPathHighlight(); });
    attachMinimapListeners();
}

// --- Compound API stubs (directory graph view removed) ---
// Kept as no-ops so any stale callers don't crash.
function compoundShouldActivate() { return false; }
function pdShouldActivate() { return false; }
function compoundFullRender() {}
function pdFullRender() {}
function compoundToggle() {}
function pdToggle() {}
function compoundCollapseAll() {}
function compoundExpandAll() {}
function pdSetView() {}
function pdUpdateToggle() {}
function _cBindHandlers() { _cBindNormalHandlers(); }
function _cUpdateColorKey() {}

// --- Layout ---
function getLayoutConfig(name) {
    const l = name || currentLayout;
    const nodeCount = cy ? cy.nodes().length : (currentGraphData ? currentGraphData.nodes.length : 10);

    if (l === 'dagre') return { name: 'dagre', rankDir: 'TB', nodeSep: 80, rankSep: 200, padding: 60 };
    if (l === 'concentric') {
        // Scale ring width with graph size so large graphs don't become giant spirals
        const lvlWidth = nodeCount < 20 ? 1 : nodeCount < 80 ? 2 : nodeCount < 200 ? 3 : 4;
        const spacing = nodeCount < 50 ? 80 : nodeCount < 200 ? 50 : 30;
        return { name: 'concentric', concentric: n => n.indegree(), levelWidth: () => lvlWidth, padding: 40, minNodeSpacing: spacing };
    }

    // Adaptive COSE: compute edge density and scale parameters accordingly.
    // Dense graphs need stronger repulsion to prevent overlaps; sparse graphs
    // need more gravity to stay cohesive.
    const edgeCount = cy ? cy.edges().length : (currentGraphData ? currentGraphData.edges.length : 0);
    const density = nodeCount > 1 ? edgeCount / (nodeCount * (nodeCount - 1)) : 0;
    const isDense = density > 0.05;

    let repulsion, edgeLen, iters, gravity;
    if (nodeCount < 10) {
        repulsion = isDense ? 4000000 : 2500000;
        edgeLen = 100;
        iters = 500;
        gravity = isDense ? 100 : 150;
    } else if (nodeCount < 50) {
        repulsion = isDense ? 20000000 : 12000000;
        edgeLen = isDense ? 300 : 250;
        iters = 1000;
        gravity = isDense ? 60 : 80;
    } else {
        repulsion = isDense ? 60000000 : 40000000;
        edgeLen = isDense ? 550 : 450;
        iters = 2000;
        gravity = isDense ? 40 : 70;
    }

    return {
        name: 'cose', padding: 40,
        nodeRepulsion: () => repulsion,
        idealEdgeLength: ele => {
            // Heavier edges pull nodes closer together
            const w = ele.data('weight') || 1;
            return edgeLen * (1.15 - w * 0.06);
        },
        edgeElasticity: () => 120,
        gravity: gravity,
        numIter: iters,
        fit: true,
    };
}

function changeLayout(name) {
    currentLayout = name;
    localStorage.setItem('layout', name);
    if (cy) {
        const config = getLayoutConfig(name);
        config.animate = false;
        config.fit = true;
        // Hide graph, run layout silently, reveal when done
        const cyContainer = document.getElementById('cy');
        const overlay = document.getElementById('loading');
        cyContainer.style.visibility = 'hidden';
        overlay.classList.add('active');
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            if (cy) cy.fit(120);
            cyContainer.style.visibility = '';
            overlay.classList.remove('active');
        };
        try {
            const layout = cy.layout(config);
            layout.one('layoutstop', finish);
            setTimeout(finish, 4000);   // safety fallback
            layout.run();
        } catch (e) {
            console.warn('[DepGraph] Layout failed:', e);
            finish();
        }
    }
}

(function restoreLayout() {
    const s = localStorage.getItem('layout');
    if (s && s !== 'dagre' && s !== 'concentric') { currentLayout = s; const r = document.querySelector(`input[name="layoutMode"][value="${s}"]`); if (r) r.checked = true; }
})();
