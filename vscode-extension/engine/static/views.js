/**
 * views.js - View rendering and switching logic
 *
 * This module handles switching between graph and tree views,
 * and contains all the rendering logic for the tree visualization.
 *
 * Dependencies:
 * - state.js (globals: _currentView, currentGraphData, cy)
 * - Utility functions: _escapeHtml (from app.js)
 */

// ================================================================
// VIEW SWITCHING
// ================================================================

function switchView(view) {
    _currentView = view;
    const cyEl = document.getElementById('cy');
    const trEl = document.getElementById('treeContainer');
    const isGraph = view === 'graph' || view === 'layers';
    const isTree = view === 'tree';

    // Deactivate layers view if switching away from it
    if (view !== 'layers' && typeof _layersActive !== 'undefined' && _layersActive) {
        deactivateLayersView();
    }

    const panels = [cyEl, trEl];
    const outgoing = panels.filter(el => el.style.display !== 'none' && el.offsetHeight > 0);
    const incoming = view === 'tree' ? trEl : cyEl;
    const fadeMs = 120;

    // Toggle toolbar controls — called when content is invisible (during swap)
    function _updateToolbar() {
        const graphOnly = document.querySelectorAll('#folderColorKey, #graphStatusBar, #pathHint, #minimap, .input-search-controls, #fisheyeToggle');
        graphOnly.forEach(el => el.style.display = isGraph ? '' : 'none');
        if (view === 'layers') {
            const hide = document.querySelectorAll('#minimap');
            hide.forEach(el => el.style.display = 'none');
        }
        ['treeToolbar', 'treeFilterWrap', 'treeBackBtn'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = isTree ? '' : 'none';
        });
        const dirFloat = document.getElementById('treeDirectionFloat');
        if (dirFloat) dirFloat.style.display = isTree ? 'flex' : 'none';
    }

    function _activateTarget() {
        cyEl.style.display = 'none';
        trEl.style.display = 'none';

        if (view === 'tree') {
            trEl.style.display = 'flex';
            renderTree();
        } else if (view === 'layers') {
            cyEl.style.display = '';
            if (cy) cy.resize();
            activateLayersView();
        } else {
            cyEl.style.display = '';
            if (cy) {
                cy.resize();
                cy.style(_normalStyles());
                const config = getLayoutConfig(currentLayout);
                config.animate = false;
                config.fit = true;
                cy.layout(config).run();
            }
        }
    }

    if (outgoing.length > 0) {
        outgoing.forEach(el => { el.style.transition = `opacity ${fadeMs}ms ease`; el.style.opacity = '0'; });
        setTimeout(() => {
            outgoing.forEach(el => { el.style.transition = ''; el.style.opacity = ''; });
            incoming.style.transition = 'none';
            incoming.style.opacity = '0';
            // Batch toolbar + panel swap into one rAF so the browser reflows once
            requestAnimationFrame(() => {
                _updateToolbar();
                _activateTarget();
                // Fade in after next frame (layout has settled)
                requestAnimationFrame(() => {
                    incoming.style.transition = `opacity ${fadeMs}ms ease`;
                    incoming.style.opacity = '1';
                    setTimeout(() => { incoming.style.transition = ''; incoming.style.opacity = ''; }, fadeMs + 50);
                });
            });
        }, fadeMs);
    } else {
        // First load — update toolbar and show immediately
        _updateToolbar();
        _activateTarget();
    }
}

function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ================================================================
// TREE VIEW
// ================================================================

let _treeRootNode = null;
let _treeDirection = 'downstream'; // 'downstream' or 'upstream'
let _treeSearchQuery = '';
let _treePendingRaf = null; // Track pending rAF to cancel on re-render
// Tree color mode follows the global _colorMode from app.js

// --- File type icon helper (shared with sidebar) ---
var _treeFileTypeIcons = {
    ts:    { label: 'TS',  bg: '#3178c6' },
    tsx:   { label: 'TX',  bg: '#3178c6' },
    js:    { label: 'JS',  bg: '#f0db4f', color: '#323330' },
    jsx:   { label: 'JX',  bg: '#f0db4f', color: '#323330' },
    mjs:   { label: 'JS',  bg: '#f0db4f', color: '#323330' },
    cjs:   { label: 'JS',  bg: '#f0db4f', color: '#323330' },
    py:    { label: 'PY',  bg: '#3776ab' },
    java:  { label: 'JA',  bg: '#b07219' },
    go:    { label: 'GO',  bg: '#00add8' },
    rs:    { label: 'RS',  bg: '#dea584' },
    c:     { label: 'C',   bg: '#555555' },
    h:     { label: 'H',   bg: '#555555' },
    cpp:   { label: 'C+',  bg: '#f34b7d' },
    cc:    { label: 'C+',  bg: '#f34b7d' },
    cxx:   { label: 'C+',  bg: '#f34b7d' },
    hpp:   { label: 'H+',  bg: '#f34b7d' },
    hxx:   { label: 'H+',  bg: '#f34b7d' },
    cs:    { label: 'C#',  bg: '#68217a' },
    swift: { label: 'SW',  bg: '#f05138' },
    rb:    { label: 'RB',  bg: '#cc342d' },
    kt:    { label: 'KT',  bg: '#A97BFF' },
    kts:   { label: 'KT',  bg: '#A97BFF' },
    scala: { label: 'SC',  bg: '#c22d40' },
    php:   { label: 'PH',  bg: '#4f5d95' },
    dart:  { label: 'DA',  bg: '#0175c2' },
    ex:    { label: 'EX',  bg: '#6e4a7e' },
    exs:   { label: 'EX',  bg: '#6e4a7e' },
};

function _treeGetFileExt(id) {
    var dot = id.lastIndexOf('.');
    return dot >= 0 ? id.substring(dot + 1).toLowerCase() : '';
}

// --- Risk summary builder for tree directory groups ---
function _treeRiskSummary(childNodes) {
    var riskPalette = { critical: '#ef4444', high: '#f97316', warning: '#eab308', normal: '#3b82f6', entry: '#22c55e', system: '#6b7280' };
    var counts = {};
    childNodes.forEach(function(c) {
        var gn = currentGraphData.nodes.find(function(n) { return n.data.id === c.id; });
        var r = gn ? (gn.data.risk || 'normal') : 'normal';
        counts[r] = (counts[r] || 0) + 1;
    });
    var wrap = document.createElement('span');
    wrap.className = 'tree-risk-summary';
    ['critical', 'high', 'warning', 'normal', 'entry'].forEach(function(r) {
        if (!counts[r]) return;
        for (var i = 0; i < Math.min(counts[r], 5); i++) {
            var dot = document.createElement('span');
            dot.className = 'tree-risk-summary-dot';
            dot.style.background = riskPalette[r];
            dot.title = counts[r] + ' ' + r;
            wrap.appendChild(dot);
        }
        if (counts[r] > 5) {
            var more = document.createElement('span');
            more.className = 'tree-risk-summary-more';
            more.textContent = '+' + (counts[r] - 5);
            more.title = counts[r] + ' ' + r;
            wrap.appendChild(more);
        }
    });
    return wrap;
}

// Helper: create a file item for the tree root picker
function _createPickerFileItem(n) {
    var item = document.createElement('div');
    item.className = 'tree-file-picker-item';
    var id = n.data.id;

    // File type badge
    var ext = _treeGetFileExt(id);
    var iconInfo = _treeFileTypeIcons[ext];
    var badge = document.createElement('span');
    badge.className = 'tree-picker-item-badge';
    if (iconInfo) {
        badge.textContent = iconInfo.label;
        badge.style.background = iconInfo.bg;
        if (iconInfo.color) badge.style.color = iconInfo.color;
    } else {
        badge.textContent = ext.substring(0, 2).toUpperCase() || '?';
        badge.style.background = '#6b7280';
    }
    item.appendChild(badge);

    // File name (just base name)
    var baseName = id.includes('/') ? id.split('/').pop() : id;
    var nameSpan = document.createElement('span');
    nameSpan.className = 'tree-picker-item-name';
    nameSpan.textContent = baseName;
    item.appendChild(nameSpan);

    // Full path as muted suffix
    var pathSpan = document.createElement('span');
    pathSpan.className = 'tree-picker-item-path';
    pathSpan.textContent = id;
    item.appendChild(pathSpan);

    item.title = id;
    item.onclick = function() { _treeRootNode = id; renderTree(); };
    return item;
}

// Helpers called from the static tree toolbar in index.html
function treeSetDirection(dir) {
    _treeDirection = dir;
    renderTree();
}

function treeChangeRoot() {
    _treeRootNode = null;
    renderTree();
}

function treeFilterFiles(query) {
    _treeSearchQuery = query;
    var container = document.getElementById('treeContainer');
    if (!container) return;
    var q = query.toLowerCase().trim();
    container.querySelectorAll('.tree-branch').forEach(function(branch) {
        var nodeEl = branch.querySelector('.tree-node');
        if (!nodeEl) return;
        if (nodeEl.classList.contains('tree-node-root')) return;
        if (!q) { branch.style.display = ''; return; }
        var allIds = branch.querySelectorAll('.tree-node');
        var anyMatch = false;
        allIds.forEach(function(n) {
            if ((n.getAttribute('data-fileid') || '').toLowerCase().includes(q)) anyMatch = true;
        });
        branch.style.display = anyMatch ? '' : 'none';
    });
}

function renderTree(rootNodeId) {
    // Cancel any pending layout callback from previous render
    if (_treePendingRaf) { cancelAnimationFrame(_treePendingRaf); _treePendingRaf = null; }

    var container = document.getElementById('treeContainer');
    container.innerHTML = '';

    if (!currentGraphData || !currentGraphData.nodes.length) {
        container.innerHTML = '<div class="tree-empty">No graph data loaded.</div>';
        return;
    }

    // If a rootNodeId is passed, use it; otherwise keep the last one
    if (rootNodeId) _treeRootNode = rootNodeId;

    // Build adjacency maps
    var downstream = {}; // file → files that depend on it (who breaks if I change?)
    var upstream = {};   // file → files it depends on (what does it import?)
    currentGraphData.nodes.forEach(function(n) {
        downstream[n.data.id] = [];
        upstream[n.data.id] = [];
    });
    currentGraphData.edges.forEach(function(e) {
        var src = e.data.source, tgt = e.data.target;
        if (downstream[tgt]) downstream[tgt].push(src);  // tgt is imported by src → src breaks if tgt changes
        if (upstream[src]) upstream[src].push(tgt);       // src imports tgt
    });

    // Compute in-degree for ref bars
    var _treeInDeg = {};
    currentGraphData.nodes.forEach(function(n) { _treeInDeg[n.data.id] = 0; });
    currentGraphData.edges.forEach(function(e) { if (_treeInDeg[e.data.target] !== undefined) _treeInDeg[e.data.target]++; });
    var _treeMaxRef = 1;
    Object.keys(_treeInDeg).forEach(function(k) { if (_treeInDeg[k] > _treeMaxRef) _treeMaxRef = _treeInDeg[k]; });

    // Sync the static tree toolbar state
    var treeDirDown = document.getElementById('treeDirDown');
    var treeDirUp = document.getElementById('treeDirUp');
    if (treeDirDown) treeDirDown.checked = (_treeDirection === 'downstream');
    if (treeDirUp) treeDirUp.checked = (_treeDirection === 'upstream');
    var treeFilterInput = document.getElementById('treeFilterInput');
    if (treeFilterInput) treeFilterInput.value = _treeSearchQuery;
    var treeRootLabel = document.getElementById('treeRootLabel');
    var treeBackBtn = document.getElementById('treeBackBtn');
    if (treeRootLabel) treeRootLabel.textContent = _treeRootNode || '';
    // Show the back button only when a root is selected
    if (treeBackBtn) treeBackBtn.style.display = _treeRootNode ? '' : 'none';

    // No root selected — show prompt with searchable, folder-grouped picker
    if (!_treeRootNode) {
        var prompt = document.createElement('div');
        prompt.className = 'tree-empty';
        prompt.innerHTML = '<div class="tree-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="14"/><line x1="12" y1="14" x2="6" y2="20"/><line x1="12" y1="14" x2="18" y2="20"/></svg></div>' +
            '<div class="tree-empty-title">Select a root file</div>' +
            '<div class="tree-empty-desc">Type to search, or browse by folder below.</div>';
        container.appendChild(prompt);

        // Search input
        var searchWrap = document.createElement('div');
        searchWrap.className = 'tree-picker-search-wrap';
        var searchIcon = document.createElement('span');
        searchIcon.className = 'tree-picker-search-icon';
        searchIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>';
        searchWrap.appendChild(searchIcon);
        var searchInput = document.createElement('input');
        searchInput.className = 'tree-picker-search';
        searchInput.type = 'text';
        searchInput.placeholder = 'Search files…';
        searchInput.setAttribute('autocomplete', 'off');
        searchInput.setAttribute('spellcheck', 'false');
        searchWrap.appendChild(searchInput);
        container.appendChild(searchWrap);

        // Sort all nodes
        var sorted = currentGraphData.nodes.slice().sort(function(a, b) {
            return a.data.id.localeCompare(b.data.id);
        });

        // Group by folder
        var folders = {};
        sorted.forEach(function(n) {
            var id = n.data.id;
            var lastSlash = id.lastIndexOf('/');
            var folder = lastSlash >= 0 ? id.substring(0, lastSlash) : '.';
            if (!folders[folder]) folders[folder] = [];
            folders[folder].push(n);
        });
        var folderNames = Object.keys(folders).sort();

        // Build the grouped picker
        var pickerList = document.createElement('div');
        pickerList.className = 'tree-file-picker';

        // Flat results area (shown during search)
        var searchResults = document.createElement('div');
        searchResults.className = 'tree-picker-results';
        searchResults.style.display = 'none';
        pickerList.appendChild(searchResults);

        // Folder groups area (shown when not searching)
        var foldersArea = document.createElement('div');
        foldersArea.className = 'tree-picker-folders';

        folderNames.forEach(function(folderName) {
            var group = document.createElement('div');
            group.className = 'tree-picker-folder-group';

            var header = document.createElement('div');
            header.className = 'tree-picker-folder-header';
            var arrow = document.createElement('span');
            arrow.className = 'tree-picker-folder-arrow';
            arrow.textContent = '▶';
            header.appendChild(arrow);
            var folderIcon = document.createElement('span');
            folderIcon.className = 'tree-picker-folder-icon';
            folderIcon.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>';
            header.appendChild(folderIcon);
            var folderLabel = document.createElement('span');
            folderLabel.className = 'tree-picker-folder-name';
            folderLabel.textContent = folderName;
            header.appendChild(folderLabel);
            var countBadge = document.createElement('span');
            countBadge.className = 'tree-picker-folder-count';
            countBadge.textContent = folders[folderName].length;
            header.appendChild(countBadge);

            var fileListInner = document.createElement('div');
            fileListInner.className = 'tree-picker-folder-files';
            fileListInner.style.display = 'none';

            folders[folderName].forEach(function(n) {
                var item = _createPickerFileItem(n);
                fileListInner.appendChild(item);
            });

            header.onclick = function() {
                var isOpen = fileListInner.style.display !== 'none';
                fileListInner.style.display = isOpen ? 'none' : '';
                arrow.textContent = isOpen ? '▶' : '▼';
                group.classList.toggle('tree-picker-folder-open', !isOpen);
            };

            group.appendChild(header);
            group.appendChild(fileListInner);
            foldersArea.appendChild(group);
        });

        pickerList.appendChild(foldersArea);
        container.appendChild(pickerList);

        // If only one folder, auto-expand it
        if (folderNames.length === 1) {
            var singleHeader = foldersArea.querySelector('.tree-picker-folder-header');
            if (singleHeader) singleHeader.click();
        }

        // Search behavior
        searchInput.oninput = function() {
            var q = searchInput.value.toLowerCase().trim();
            if (!q) {
                searchResults.style.display = 'none';
                searchResults.innerHTML = '';
                foldersArea.style.display = '';
                return;
            }
            foldersArea.style.display = 'none';
            searchResults.style.display = '';
            searchResults.innerHTML = '';
            var count = 0;
            sorted.forEach(function(n) {
                if (count >= 30) return; // cap results
                if (n.data.id.toLowerCase().includes(q)) {
                    var item = _createPickerFileItem(n);
                    searchResults.appendChild(item);
                    count++;
                }
            });
            if (count === 0) {
                var noMatch = document.createElement('div');
                noMatch.className = 'tree-picker-no-match';
                noMatch.textContent = 'No files match "' + searchInput.value + '"';
                searchResults.appendChild(noMatch);
            }
        };

        // Auto-focus the search input
        requestAnimationFrame(function() { searchInput.focus(); });

        return;
    }

    // Build tree via BFS (avoid cycles)
    var adj = _treeDirection === 'downstream' ? downstream : upstream;
    var treeData = _buildTreeBFS(_treeRootNode, adj);

    // Render the tree with zoom wrapper
    var treeEl = document.createElement('div');
    treeEl.className = 'tree-graph';

    var zoomLayer = document.createElement('div');
    zoomLayer.className = 'tree-zoom-layer';
    // Start invisible — reveal after hbars positioned to prevent flash
    zoomLayer.style.opacity = '0';

    var rootEl = _renderTreeNode(treeData, adj, 0, _treeInDeg, _treeMaxRef);
    zoomLayer.appendChild(rootEl);
    treeEl.appendChild(zoomLayer);
    container.appendChild(treeEl);

    // Zoom controls
    var zoomControls = document.createElement('div');
    zoomControls.className = 'tree-zoom-controls';
    zoomControls.innerHTML =
        '<button class="tree-zoom-btn" data-action="in" title="Zoom in">+</button>' +
        '<span class="tree-zoom-level">100%</span>' +
        '<button class="tree-zoom-btn" data-action="out" title="Zoom out">&minus;</button>' +
        '<button class="tree-zoom-btn tree-zoom-reset" data-action="reset" title="Reset zoom">&#8634;</button>';
    // Append to container (tree-container) instead of treeEl (tree-graph)
    // so the controls stay fixed in the corner and don't scroll with content.
    container.appendChild(zoomControls);

    // Position horizontal bars, center on root, then reveal.
    // Double rAF ensures all nested elements have been laid out.
    _treePendingRaf = requestAnimationFrame(function() {
        _treePendingRaf = requestAnimationFrame(function() {
            _treePendingRaf = null;
            _positionTreeHbars(zoomLayer);
            // Center scroll on the root node so it's visible on load
            var rootNode = zoomLayer.querySelector('.tree-node-root');
            if (rootNode) {
                var rootRect = rootNode.getBoundingClientRect();
                var treeRect = treeEl.getBoundingClientRect();
                var rootCenterX = rootRect.left - treeRect.left + treeEl.scrollLeft + rootRect.width / 2;
                var rootTopY = rootRect.top - treeRect.top + treeEl.scrollTop;
                treeEl.scrollLeft = rootCenterX - treeEl.clientWidth / 2;
                treeEl.scrollTop  = Math.max(0, rootTopY - treeEl.clientHeight * 0.3);
            } else {
                var scrollW = treeEl.scrollWidth - treeEl.clientWidth;
                if (scrollW > 0) treeEl.scrollLeft = scrollW / 2;
            }
            // Reveal — fast fade-in so it feels instant but avoids the flash
            zoomLayer.style.transition = 'opacity 0.08s ease';
            zoomLayer.style.opacity = '1';
        });
    });

    // --- Pan/drag + zoom ---
    _initTreePanZoom(treeEl, zoomLayer, zoomControls.querySelector('.tree-zoom-level'), zoomControls);

    // Apply search filter if active
    if (_treeSearchQuery) searchInput.oninput.call(searchInput);
}

function _positionTreeHbars(root) {
    var hbars = root.querySelectorAll('.tree-hbar');
    hbars.forEach(function(hbar) {
        var row = hbar.parentElement;
        if (!row) return;

        // Get all child-col siblings (exclude the hbar itself)
        var cols = [];
        for (var i = 0; i < row.children.length; i++) {
            if (row.children[i].classList.contains('tree-child-col')) {
                cols.push(row.children[i]);
            }
        }
        if (cols.length < 2) return;

        // Use offsetLeft/offsetWidth instead of getBoundingClientRect —
        // these return layout values unaffected by CSS scale transforms
        var rowW = row.offsetWidth;
        var firstCenter = cols[0].offsetLeft + cols[0].offsetWidth / 2;
        var lastCenter = cols[cols.length - 1].offsetLeft + cols[cols.length - 1].offsetWidth / 2;

        // --- Align anchor child directly beneath parent stem ---
        // The parent stem drops at rowW/2 (align-items:center on .tree-branch).
        // For asymmetric subtrees the center child drifts away from rowW/2.
        // Shift the entire row so the anchor child sits under the stem.
        //
        // Anchor: center child for odd counts, midpoint of two center
        //         children for even counts.
        var midIdx = Math.floor(cols.length / 2);
        var anchorX;
        if (cols.length % 2 === 1) {
            anchorX = cols[midIdx].offsetLeft + cols[midIdx].offsetWidth / 2;
        } else {
            var lc = cols[midIdx - 1].offsetLeft + cols[midIdx - 1].offsetWidth / 2;
            var rc = cols[midIdx].offsetLeft + cols[midIdx].offsetWidth / 2;
            anchorX = (lc + rc) / 2;
        }

        var offset = rowW / 2 - anchorX;
        if (Math.abs(offset) > 0.5) {
            row.style.transform = 'translateX(' + offset + 'px)';
        } else {
            row.style.transform = '';
        }

        // Position hbar from first to last child center.
        // After the transform the parent stem lands at anchorX in the row's
        // local coordinate space, which is always between firstCenter and
        // lastCenter, so the hbar naturally covers the stem junction.
        hbar.style.left = firstCenter + 'px';
        hbar.style.right = (rowW - lastCenter) + 'px';
    });
}

function _initTreePanZoom(el, zoomLayer, zoomLabel, zoomControlsEl) {
    var isPanning = false;
    var startX = 0, startY = 0, scrollLeft = 0, scrollTop = 0;
    var scale = 1;
    var MIN_ZOOM = 0.15;
    var MAX_ZOOM = 3;

    function applyZoom() {
        zoomLayer.style.transform = 'scale(' + scale + ')';
        zoomLabel.textContent = Math.round(scale * 100) + '%';
        // Reposition hbars after zoom
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                _positionTreeHbars(zoomLayer);
            });
        });
    }

    // Mouse wheel zoom
    el.addEventListener('wheel', function(e) {
        if (e.ctrlKey || e.metaKey) {
            // Pinch-to-zoom on trackpad (ctrl+wheel) or cmd+wheel
            e.preventDefault();
            var delta = -e.deltaY * 0.01;
            scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale + delta));
            applyZoom();
        } else {
            // Regular scroll-wheel zoom
            e.preventDefault();
            var delta = e.deltaY > 0 ? -0.08 : 0.08;
            scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale + delta));
            applyZoom();
        }
    }, { passive: false });

    // Zoom control buttons (attached to the controls element, which may
    // live outside the scrollable tree-graph)
    (zoomControlsEl || el).addEventListener('click', function(e) {
        var btn = e.target.closest('.tree-zoom-btn');
        if (!btn) return;
        var action = btn.getAttribute('data-action');
        if (action === 'in') {
            scale = Math.min(MAX_ZOOM, scale + 0.15);
        } else if (action === 'out') {
            scale = Math.max(MIN_ZOOM, scale - 0.15);
        } else if (action === 'reset') {
            scale = 1;
        }
        // Brief transition for button-triggered zooms only
        zoomLayer.style.transition = 'transform 0.12s ease';
        applyZoom();
        setTimeout(function() { zoomLayer.style.transition = ''; }, 140);
    });

    // Pan via mouse drag
    el.addEventListener('mousedown', function(e) {
        if (e.target.closest('button, input, a, .tree-node')) return;
        isPanning = true;
        startX = e.clientX;
        startY = e.clientY;
        scrollLeft = el.scrollLeft;
        scrollTop = el.scrollTop;
        el.classList.add('tree-graph-grabbing');
        e.preventDefault();
    });

    el.addEventListener('mousemove', function(e) {
        if (!isPanning) return;
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        el.scrollLeft = scrollLeft - dx;
        el.scrollTop = scrollTop - dy;
    });

    el.addEventListener('mouseup', function() {
        isPanning = false;
        el.classList.remove('tree-graph-grabbing');
    });

    el.addEventListener('mouseleave', function() {
        isPanning = false;
        el.classList.remove('tree-graph-grabbing');
    });
}

function _buildTreeBFS(rootId, adj) {
    var visited = new Set();
    visited.add(rootId);

    function build(nodeId, depth) {
        if (depth > 20) return { id: nodeId, children: [] }; // safety limit
        var children = [];
        var neighbors = (adj[nodeId] || []).slice().sort();
        for (var i = 0; i < neighbors.length; i++) {
            var nid = neighbors[i];
            if (!visited.has(nid)) {
                visited.add(nid);
                children.push(build(nid, depth + 1));
            }
        }
        return { id: nodeId, children: children };
    }

    return build(rootId, 0);
}

function _renderTreeNode(node, adj, depth, inDeg, maxRef) {
    // Vertical cascade layout:
    //
    //         [ parent ]
    //      ───────┬───────
    //      ↓      ↓      ↓
    //   [child] [child] [child]
    //             ─┬─
    //             ↓
    //          [grandchild]

    var wrapper = document.createElement('div');
    wrapper.className = 'tree-branch';

    // --- Build the node card ---
    var card = document.createElement('div');
    card.className = 'tree-node' + (depth === 0 ? ' tree-node-root' : '');
    card.setAttribute('data-depth', depth);
    card.setAttribute('data-fileid', node.id);

    // Left section (badge, dot, name)
    var leftSection = document.createElement('div');
    leftSection.className = 'tree-node-left';

    var ext = _treeGetFileExt(node.id);
    var iconInfo = _treeFileTypeIcons[ext];
    var typeBadge = document.createElement('span');
    typeBadge.className = 'tree-file-type-badge';
    if (iconInfo) {
        typeBadge.textContent = iconInfo.label;
        typeBadge.style.background = iconInfo.bg;
        if (iconInfo.color) typeBadge.style.color = iconInfo.color;
    } else {
        typeBadge.textContent = ext.substring(0, 2).toUpperCase() || '?';
        typeBadge.style.background = '#6b7280';
    }
    leftSection.appendChild(typeBadge);

    var gNode = currentGraphData.nodes.find(function(n) { return n.data.id === node.id; });
    var riskPalette = { critical: '#ef4444', high: '#f97316', warning: '#eab308', normal: '#3b82f6', entry: '#22c55e', system: '#6b7280' };
    var riskLabels = { critical: 'Critical / God file', high: 'High influence', warning: 'High dependency', normal: 'Normal', entry: 'Entry point', system: 'System' };
    var dirColor = gNode ? (gNode.data.dir_color || gNode.data.color) : '#64748b';
    var risk = gNode ? (gNode.data.risk || 'normal') : 'normal';
    var riskColor = riskPalette[risk] || riskPalette.normal;
    var dotColor = _colorMode === 'risk' ? riskColor : dirColor;
    var dotTitle = _colorMode === 'risk' ? (riskLabels[risk] || risk) : (node.id.includes('/') ? node.id.substring(0, node.id.lastIndexOf('/')) : '.');
    var dot = document.createElement('span');
    dot.className = 'tree-node-dot';
    dot.style.background = dotColor;
    dot.title = dotTitle;
    leftSection.appendChild(dot);

    var nameEl = document.createElement('span');
    nameEl.className = 'tree-node-name tree-name-truncate';
    var baseName = node.id.includes('/') ? node.id.split('/').pop() : node.id;
    nameEl.textContent = baseName;
    nameEl.title = node.id;
    leftSection.appendChild(nameEl);

    card.appendChild(leftSection);

    // Right section
    var rightSection = document.createElement('div');
    rightSection.className = 'tree-node-right';

    if (node.children.length > 0) {
        rightSection.appendChild(_treeRiskSummary(node.children));
    }

    var focusBtn = document.createElement('button');
    focusBtn.className = 'tree-focus-btn';
    focusBtn.title = 'Focus on graph';
    focusBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>';
    focusBtn.onclick = function(e) {
        e.stopPropagation();
        if (!cy) return;
        document.getElementById('viewGraph').checked = true;
        switchView('graph');
        setTimeout(function() {
            var n = cy.getElementById(node.id);
            if (n.length) {
                highlightPaths(node.id);
                showBlastRadius(node.id);
                cy.animate({ center: { eles: n }, zoom: 1.5 }, { duration: 400 });
            }
        }, 200);
    };
    rightSection.appendChild(focusBtn);

    card.appendChild(rightSection);

    card.onclick = function(e) {
        e.stopPropagation();
        _treeRootNode = node.id;
        renderTree();
    };
    card.ondblclick = function(e) {
        e.stopPropagation();
        openPreview(node.id);
    };

    wrapper.appendChild(card);

    // --- Children: horizontal bar through card, vertical drops, child row ---
    if (node.children.length > 0) {
        // Vertical stem from card center down
        var stem = document.createElement('div');
        stem.className = 'tree-stem';
        wrapper.appendChild(stem);

        // Children row container
        // Structure: the hbar is positioned across the top of the row,
        // and each child-col has its own drop arrow → child branch.
        // This keeps drops perfectly aligned with their children.
        var childrenRow = document.createElement('div');
        childrenRow.className = 'tree-children-row';

        for (var j = 0; j < node.children.length; j++) {
            var childCol = document.createElement('div');
            childCol.className = 'tree-child-col';

            // Drop arrow above child
            var drop = document.createElement('div');
            drop.className = 'tree-drop';
            childCol.appendChild(drop);

            var childEl = _renderTreeNode(node.children[j], adj, depth + 1, inDeg, maxRef);
            childCol.appendChild(childEl);

            childrenRow.appendChild(childCol);
        }

        // For multiple children, add a horizontal bar element (positioned after render)
        if (node.children.length > 1) {
            var hbar = document.createElement('div');
            hbar.className = 'tree-hbar';
            childrenRow.appendChild(hbar);
            childrenRow.classList.add('tree-children-row-multi');
        }

        wrapper.appendChild(childrenRow);
    }

    return wrapper;
}

// Hook: when a node is clicked in the graph, set it as tree root
function setTreeRoot(nodeId) {
    _treeRootNode = nodeId;
    if (_currentView === 'tree') renderTree();
}
