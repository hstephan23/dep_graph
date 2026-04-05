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

/** Styles for compound node mode — directory containers + file children + aggregated edges */
function _compoundStyles() {
    const t = _cTheme();
    return [
        // File nodes (children inside directories)
        { selector: 'node[?isFile]', style: {
            ..._baseNodeStyle(),
            'transition-property': 'opacity',
            'transition-duration': '0.25s',
        }},
        // Directory compound nodes (base — expanded state)
        { selector: 'node[?isDir]', style: {
            'background-color': 'data(color)',
            'background-opacity': t.dark ? 0.06 : 0.04,
            'border-width': 1.5,
            'border-color': 'data(color)',
            'border-style': 'solid',
            'border-opacity': 0.3,
            shape: 'round-rectangle',
            padding: '24px',
            label: ele => ele.data('label'),
            color: t.labelColor,
            'text-outline-color': t.labelOutline,
            'text-outline-width': 2,
            'text-outline-opacity': 0.8,
            'font-size': '11px',
            'font-weight': '600',
            'text-valign': 'top',
            'text-halign': 'left',
            'text-margin-y': '-6px',
            'text-margin-x': '8px',
            'text-transform': 'uppercase',
            'min-width': '60px',
            'min-height': '40px',
            'transition-property': 'background-opacity, border-width, border-opacity, padding',
            'transition-duration': '0.3s',
        }},
        // Collapsed directory nodes — compact pill shape
        { selector: 'node[?isCollapsed]', style: {
            'background-color': 'data(color)',
            'background-opacity': t.dark ? 0.15 : 0.10,
            'border-width': 2,
            'border-opacity': 0.6,
            'border-style': 'dashed',
            padding: '0px',
            width: 'data(collapsedSize)',
            height: 'data(collapsedSize)',
            label: ele => {
                const name = ele.data('label');
                const count = ele.data('fileCount');
                return name + '\n' + count + ' file' + (count !== 1 ? 's' : '');
            },
            color: 'data(color)',
            'text-outline-color': t.labelOutline,
            'text-outline-width': 2,
            'text-outline-opacity': 0.9,
            'font-size': ele => Math.max(11, Math.min(16, (ele.data('collapsedSize') || 60) / 6)) + 'px',
            'font-weight': '600',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-margin-y': '0px',
            'text-margin-x': '0px',
            'text-transform': 'none',
            'text-wrap': 'wrap',
            'text-max-width': '120px',
        }},
        // Expanded directory — show folder icon
        { selector: 'node[?isDir][!isCollapsed]', style: {
            label: ele => ele.data('label'),
        }},
        // Hover on directory
        { selector: 'node[?isDir].dir-hover', style: {
            'border-width': 2.5,
            'border-opacity': 0.7,
            'overlay-color': 'data(color)',
            'overlay-opacity': 0.04,
        }},
        // Collapsed hover — lift effect
        { selector: 'node[?isCollapsed].dir-hover', style: {
            'background-opacity': t.dark ? 0.2 : 0.14,
            'border-opacity': 0.8,
        }},
        // Aggregated edges (between collapsed dirs)
        { selector: 'edge[?isAggregated]', style: {
            ..._baseEdgeStyle(),
            width: 'data(aggWidth)',
            'curve-style': 'bezier',
            label: ele => {
                const count = ele.data('edgeCount') || 0;
                return count > 1 ? count + '' : '';
            },
            'font-size': '10px',
            'font-weight': '600',
            color: t.labelColor,
            'text-outline-color': t.edgeLabelOutline,
            'text-outline-width': 2,
            'text-outline-opacity': 0.9,
            'text-rotation': 'autorotate',
            'text-margin-y': '-8px',
        }},
        // Normal file-level edges
        { selector: 'edge[!isAggregated]', style: _baseEdgeStyle() },
        { selector: 'edge.cycle', style: _cycleEdgeStyle() },
    ];
}

// --- Build compound elements from raw graph data ---

function _cBuildDirMap(data) {
    const dirMap = new Map();
    data.nodes.forEach(n => {
        const dir = _cDir(n.data.id);
        if (!dirMap.has(dir)) dirMap.set(dir, new Set());
        dirMap.get(dir).add(n.data.id);
    });
    return dirMap;
}

/** Get the immediate parent directory of a directory */
function _cParentDir(dirId) {
    if (dirId === '.') return null;
    const i = dirId.lastIndexOf('/');
    return i === -1 ? '.' : dirId.substring(0, i);
}

/** Build all compound elements: directory parent nodes + file child nodes + edges */
function _cBuildElements(data) {
    const dirMap = _cBuildDirMap(data);
    _compound.dirMap = dirMap;

    // Collect all unique directories including intermediate ones
    const allDirIds = new Set();
    dirMap.forEach((files, dir) => {
        _cAncestors(dir).forEach(d => allDirIds.add(d));
    });
    _compound.allDirs = [...allDirIds].sort();

    const elements = [];

    // 1. Create directory (parent) nodes — sorted by depth so parents are added first
    const sortedDirs = _compound.allDirs.slice().sort((a, b) => {
        const da = a === '.' ? 0 : a.split('/').length;
        const db = b === '.' ? 0 : b.split('/').length;
        return da - db;
    });

    // Skip root '.' if it's the only directory (flat project structure)
    const skipRoot = allDirIds.size === 1 && allDirIds.has('.');

    sortedDirs.forEach(dirId => {
        if (skipRoot && dirId === '.') return;
        const isCollapsed = _compound.collapsed.has(dirId);
        // Skip collapsed root with no direct files — its children become top-level nodes
        if (dirId === '.' && isCollapsed && (!dirMap.has('.') || dirMap.get('.').size === 0)) return;

        const parentDir = _cParentDir(dirId);
        const directFiles = dirMap.has(dirId) ? dirMap.get(dirId).size : 0;
        // Count total files in this dir and all subdirs
        let totalFiles = directFiles;
        _compound.allDirs.forEach(d => {
            if (d !== dirId && d.startsWith(dirId + '/')) {
                totalFiles += (dirMap.has(d) ? dirMap.get(d).size : 0);
            }
        });
        // When collapsed, count ALL files under this tree (not just direct files)
        let collapsedFileCount = totalFiles;
        const dirLabel = dirId === '.' ? '(root)' : dirId.split('/').pop();

        const nodeData = {
            id: 'dir:' + dirId,
            label: dirLabel,
            color: _cColor(dirId),
            isDir: true,
            isFile: false,
            isCollapsed: isCollapsed,
            dirId: dirId,
            fileCount: isCollapsed ? collapsedFileCount : totalFiles,
            collapsedSize: Math.min(120, 55 + Math.sqrt(isCollapsed ? collapsedFileCount : totalFiles) * 15),
        };

        // Set parent for nested directories.
        // Skip if: (a) root is the only dir, or (b) the parent is collapsed
        // (collapsed parents act as standalone nodes, not containers)
        if (parentDir !== null && allDirIds.has(parentDir) && !(skipRoot && parentDir === '.')) {
            const parentCollapsed = _compound.collapsed.has(parentDir);
            if (!parentCollapsed) {
                nodeData.parent = 'dir:' + parentDir;
            }
        }

        elements.push({ group: 'nodes', data: nodeData });
    });

    // 2. Create file (child) nodes
    data.nodes.forEach(n => {
        const fileId = n.data.id;
        const dir = _cDir(fileId);

        // Check if any ancestor is collapsed — if so, hide this file
        const ancestors = _cAncestors(dir);
        // Ignore root '.' when skipRoot — those files should appear as top-level nodes
        const hiddenByCollapse = ancestors.some(d =>
            _compound.collapsed.has(d) && !(skipRoot && d === '.')
        );
        if (hiddenByCollapse) return;

        const fileName = fileId.split('/').pop();
        const nodeData = {
            ...n.data,
            id: fileId,
            label: fileName,
            isDir: false,
            isFile: true,
            isCollapsed: false,
        };
        // Set parent if the dir node exists and is NOT collapsed
        if (!(skipRoot && dir === '.')) {
            const dirCollapsed = _compound.collapsed.has(dir);
            if (!dirCollapsed) {
                nodeData.parent = 'dir:' + dir;
            }
        }
        elements.push({ group: 'nodes', data: nodeData });
    });

    // 3. Build edges — aggregate when endpoints are inside collapsed dirs
    const fileToVisible = {};
    data.nodes.forEach(n => {
        const dir = _cDir(n.data.id);
        const ancestors = _cAncestors(dir);
        // Find the topmost collapsed ancestor
        let collapsedAt = null;
        for (const a of ancestors) {
            if (_compound.collapsed.has(a) && !(skipRoot && a === '.')) { collapsedAt = a; break; }
        }
        fileToVisible[n.data.id] = collapsedAt ? 'dir:' + collapsedAt : n.data.id;
    });

    const edgeCounts = new Map();
    data.edges.forEach(e => {
        const s = fileToVisible[e.data.source] || e.data.source;
        const t = fileToVisible[e.data.target] || e.data.target;
        if (s === t) return;
        const key = s + '\t' + t;
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    });

    edgeCounts.forEach((count, key) => {
        const [s, t] = key.split('\t');
        const isAgg = s.startsWith('dir:') || t.startsWith('dir:');
        elements.push({ group: 'edges', data: {
            id: 'e:' + s + '->' + t,
            source: s,
            target: t,
            color: isAgg ? (count > 5 ? '#f97316' : count > 2 ? '#60a5fa' : '#94a3b8') : (data.edges.find(e => e.data.source === s && e.data.target === t) || { data: { color: '#94a3b8' } }).data.color,
            isAggregated: isAgg,
            edgeCount: count,
            aggWidth: isAgg ? Math.min(8, 1.5 + Math.log2(count) * 1.5) : 3,
        }});
    });

    return elements;
}

// --- Cytoscape init ---

/** Auto-fit the graph after layout completes, with a timeout fallback.
 *  Shows the loading spinner while the layout runs and reveals the graph
 *  only once it is fully positioned and fitted — no zoom-in-then-out. */
// _cAutoFit is now handled inside _cInitCy — kept as a no-op for any stale callers
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

function _cBindHandlers() {
    // Remove only interaction events (not layout events like layoutstop)
    cy.off('tap dbltap mouseover mouseout');
    const container = cy.container();
    cy.on('tap', 'node[?isDir]', evt => {
        const dirId = evt.target.data('dirId');
        if (dirId) compoundToggle(dirId);
    });
    cy.on('tap', 'node[?isFile]', evt => {
        clearPathHighlight();
        highlightPaths(evt.target.id());
        showBlastRadius(evt.target.id());
    });
    cy.on('dbltap', 'node[?isFile]', evt => openPreview(evt.target.id()));
    cy.on('tap', evt => { if (evt.target === cy) clearPathHighlight(); });
    cy.on('mouseover', 'node[?isDir]', evt => {
        evt.target.addClass('dir-hover');
        if (container) container.style.cursor = 'pointer';
    });
    cy.on('mouseout', 'node[?isDir]', evt => {
        evt.target.removeClass('dir-hover');
        if (container) container.style.cursor = '';
    });
    attachMinimapListeners();            // re-attach after removeAllListeners
}

function _cBindNormalHandlers() {
    // Remove only interaction events (not layout events like layoutstop)
    cy.off('tap dbltap mouseover mouseout');
    cy.on('tap', 'node', evt => { clearPathHighlight(); highlightPaths(evt.target.id()); showBlastRadius(evt.target.id()); setTreeRoot(evt.target.id()); });
    cy.on('dbltap', 'node', evt => openPreview(evt.target.id()));
    cy.on('tap', evt => { if (evt.target === cy) clearPathHighlight(); });
    attachMinimapListeners();
}

// --- Public API ---

function compoundShouldActivate(data) {
    return data.nodes && data.nodes.length > COMPOUND_THRESHOLD;
}

// Aliases for backward compat (renderGraph and other callers reference these)
function pdShouldActivate(data) { return compoundShouldActivate(data); }

/** Full render in compound mode — all dirs start collapsed */
function compoundFullRender(data) {
    const dirMap = _cBuildDirMap(data);
    // Start with all directories collapsed
    const collapsed = new Set();
    dirMap.forEach((files, dir) => {
        _cAncestors(dir).forEach(d => collapsed.add(d));
    });

    _compound = { active: true, raw: data, collapsed, dirMap, allDirs: [] };
    const elements = _cBuildElements(data);
    _cInitCy(elements, _compoundStyles());
    _cBindHandlers();
    _cUpdateColorKey();

    // Auto-fit after layout settles (with timeout fallback for small graphs)
    _cAutoFit();
}

// Alias for backward compat
function pdFullRender(data) { compoundFullRender(data); }

/** Toggle expand/collapse of a directory */
function compoundToggle(dirId) {
    if (!_compound.raw || !cy) return;

    if (_compound.collapsed.has(dirId)) {
        // Expand: remove from collapsed set
        _compound.collapsed.delete(dirId);
    } else {
        // Collapse: add to collapsed set, also collapse children
        _compound.collapsed.add(dirId);
        _compound.allDirs.forEach(d => {
            if (d.startsWith(dirId + '/')) _compound.collapsed.add(d);
        });
    }

    // Rebuild the graph with new collapse state
    const elements = _cBuildElements(_compound.raw);

    // Snapshot positions of surviving nodes
    const positions = {};
    cy.nodes().forEach(n => { positions[n.id()] = { ...n.position() }; });

    cy.batch(() => {
        cy.elements().remove();
        cy.add(elements);
    });

    // Restore known positions
    cy.nodes().forEach(n => {
        if (positions[n.id()]) {
            n.position(positions[n.id()]);
        } else {
            // New nodes (just expanded): place near their parent directory
            const parentPos = positions['dir:' + dirId];
            if (parentPos) {
                n.position({
                    x: parentPos.x + (Math.random() - 0.5) * 80,
                    y: parentPos.y + (Math.random() - 0.5) * 80,
                });
            }
        }
    });

    // Re-apply compound styles (theme-aware)
    cy.style(_compoundStyles());

    // Stop any previously running layout to avoid race conditions
    if (_runningLayout) { try { _runningLayout.stop(); } catch(e) {} _runningLayout = null; }

    // Hide graph, run layout silently, reveal when done — no stuttering
    const cyContainer = document.getElementById('cy');
    const overlay = document.getElementById('loading');
    cyContainer.style.visibility = 'hidden';
    overlay.classList.add('active');

    _runningLayout = cy.layout({
        ...getLayoutConfig(),
        animate: false,
        fit: true,
        padding: 80,
    });
    _runningLayout.one('layoutstop', () => {
        _runningLayout = null;
        if (cy) cy.fit(120);
        cyContainer.style.visibility = '';
        overlay.classList.remove('active');
    });
    _runningLayout.run();

    _cUpdateColorKey();
}

// Alias for backward compat
function pdToggle(dirId) { compoundToggle(dirId); }

/** Collapse all directories */
function compoundCollapseAll() {
    if (!_compound.raw || !_compound.active) return;
    if (_runningLayout) { try { _runningLayout.stop(); } catch(e) {} _runningLayout = null; }
    _compound.allDirs.forEach(d => _compound.collapsed.add(d));
    const elements = _cBuildElements(_compound.raw);
    const cyContainer = document.getElementById('cy');
    const overlay = document.getElementById('loading');
    cyContainer.style.visibility = 'hidden';
    overlay.classList.add('active');
    cy.batch(() => { cy.elements().remove(); cy.add(elements); });
    cy.style(_compoundStyles());
    _runningLayout = cy.layout({ ...getLayoutConfig(), animate: false, fit: true, padding: 80 });
    _runningLayout.one('layoutstop', () => { _runningLayout = null; if (cy) cy.fit(120); cyContainer.style.visibility = ''; overlay.classList.remove('active'); });
    _runningLayout.run();
    _cUpdateColorKey();
}

/** Expand all directories */
function compoundExpandAll() {
    if (!_compound.raw || !_compound.active) return;
    if (_runningLayout) { try { _runningLayout.stop(); } catch(e) {} _runningLayout = null; }
    _compound.collapsed.clear();
    const elements = _cBuildElements(_compound.raw);
    const cyContainer = document.getElementById('cy');
    const overlay = document.getElementById('loading');
    cyContainer.style.visibility = 'hidden';
    overlay.classList.add('active');
    cy.batch(() => { cy.elements().remove(); cy.add(elements); });
    cy.style(_compoundStyles());
    _runningLayout = cy.layout({ ...getLayoutConfig(), animate: false, fit: true, padding: 80 });
    _runningLayout.one('layoutstop', () => { _runningLayout = null; if (cy) cy.fit(120); cyContainer.style.visibility = ''; overlay.classList.remove('active'); });
    _runningLayout.run();
    _cUpdateColorKey();
}

/** Switch between compound (directory) / flat (all files) view */
function pdSetView(mode) {
    if (!currentGraphData) return;
    if (mode === 'files') {
        _compound.active = false;
        _compound.raw = null;
        _compound.collapsed = new Set();
        const elements = [...currentGraphData.nodes.map(n => ({
            group: 'nodes', data: { ...n.data, label: n.data.id },
        })), ...currentGraphData.edges];
        _cInitCy(elements, _normalStyles());
        _cBindNormalHandlers();
        if (typeof buildColorKey === 'function') buildColorKey(currentGraphData.nodes);
        else buildFolderColorKey(currentGraphData.nodes);
        _cAutoFit();
    } else {
        compoundFullRender(currentGraphData);
    }
}

function pdUpdateToggle() {
    const el = document.getElementById('pdViewToggle');
    if (el) el.style.display = currentGraphData ? '' : 'none';
    // Show collapse/expand buttons only in compound (directory) mode
    const colBtn = document.getElementById('compoundCollapseAllBtn');
    const expBtn = document.getElementById('compoundExpandAllBtn');
    if (colBtn) colBtn.style.display = _compound.active ? '' : 'none';
    if (expBtn) expBtn.style.display = _compound.active ? '' : 'none';
}

function _cUpdateColorKey() {
    if (!cy) return;
    const nodes = [];
    cy.nodes('[?isFile]').forEach(n => nodes.push({ data: { id: n.id(), color: n.data('color') } }));
    // Also include collapsed dir colors
    cy.nodes('[?isCollapsed]').forEach(n => nodes.push({ data: { id: n.data('dirId') || n.id(), color: n.data('color') } }));
    if (typeof buildColorKey === 'function') buildColorKey(nodes);
    else buildFolderColorKey(nodes);
}

// --- Layout ---
function getLayoutConfig(name) {
    const l = name || currentLayout;
    const nodeCount = cy ? cy.nodes().length : (currentGraphData ? currentGraphData.nodes.length : 10);

    // Compound mode uses lighter COSE settings for faster layout
    if (_compound && _compound.active && l === 'cose') {
        const repulsion = nodeCount < 20 ? 2000000 : 8000000;
        const edgeLen = nodeCount < 20 ? 100 : 200;
        const iters = nodeCount < 20 ? 300 : 500;
        return { name: 'cose', padding: 60, nodeRepulsion: () => repulsion, idealEdgeLength: () => edgeLen, edgeElasticity: () => 100, gravity: 80, numIter: iters, fit: true };
    }
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
