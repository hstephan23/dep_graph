/**
 * views.js - View rendering and switching logic
 *
 * This module handles switching between graph, treemap, and tree views,
 * and contains all the rendering logic for treemap and tree visualizations.
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

    // Graph-only overlays: hide when not on graph
    const graphOnly = document.querySelectorAll('#folderColorKey, #graphStatusBar, #pathHint, #minimap, .input-search-controls, #layoutGroup, #pdViewToggle');
    const isGraph = view === 'graph';
    graphOnly.forEach(el => el.style.display = isGraph ? '' : 'none');

    // Tree-only controls: show only in tree view
    const isTree = view === 'tree';
    ['treeToolbar', 'treeFilterWrap', 'treeBackBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = isTree ? '' : 'none';
    });

    const panels = [cyEl, trEl];
    const outgoing = panels.filter(el => el.style.display !== 'none' && el.offsetHeight > 0);

    function _showTarget() {
        // Hide all panels (no opacity tricks — just display)
        cyEl.style.display = 'none';
        trEl.style.display = 'none';

        // Show the target view
        if (view === 'tree') {
            trEl.style.display = 'flex';
            renderTree();
        } else {
            cyEl.style.display = '';
            if (cy) cy.resize();
        }
    }

    // If there's a visible outgoing panel, crossfade; otherwise show immediately
    if (outgoing.length > 0) {
        const fadeMs = 150;
        const incoming = view === 'tree' ? trEl : cyEl;
        outgoing.forEach(el => { el.style.transition = `opacity ${fadeMs}ms ease`; el.style.opacity = '0'; });
        setTimeout(() => {
            // Clean outgoing styles
            outgoing.forEach(el => { el.style.transition = ''; el.style.opacity = ''; });
            // Prepare incoming: hidden at opacity 0
            incoming.style.opacity = '0';
            _showTarget();
            // Fade in
            requestAnimationFrame(() => {
                incoming.style.transition = `opacity ${fadeMs}ms ease`;
                incoming.style.opacity = '1';
                setTimeout(() => { incoming.style.transition = ''; incoming.style.opacity = ''; }, fadeMs + 50);
            });
        }, fadeMs);
    } else {
        // First load or no outgoing panel — just show immediately, no animation
        _showTarget();
    }
}

// ================================================================
// TREEMAP VIEW
// ================================================================

// Tooltip singleton
const _tmTooltip = document.createElement('div');
_tmTooltip.className = 'tm-tooltip';
document.body.appendChild(_tmTooltip);

function _tmShowTooltip(e, data) {
    const metricLabel = document.getElementById('treemapMetric').selectedOptions[0].text;
    _tmTooltip.innerHTML =
        '<div class="tm-tooltip-title">' + _escapeHtml(data.id) + '</div>'
        + '<div class="tm-tooltip-row"><span>Directory</span><span class="tm-tooltip-val">' + _escapeHtml(data.dir) + '</span></div>'
        + '<div class="tm-tooltip-row"><span>' + _escapeHtml(metricLabel) + '</span><span class="tm-tooltip-val">' + data.sizeValue + '</span></div>'
        + '<div class="tm-tooltip-row"><span>Inbound</span><span class="tm-tooltip-val">' + data.inbound + '</span></div>'
        + '<div class="tm-tooltip-row"><span>Outbound</span><span class="tm-tooltip-val">' + data.outbound + '</span></div>'
        + '<div class="tm-tooltip-row"><span>Impact</span><span class="tm-tooltip-val">' + data.impact + '</span></div>'
        + '<div class="tm-tooltip-row"><span>Stability</span><span class="tm-tooltip-val">' + data.stability + '</span></div>';
    _tmTooltip.classList.add('visible');
    _positionTooltip(e);
}

function _positionTooltip(e) {
    var tt = _tmTooltip;
    var pad = 12;
    var x = e.clientX + pad;
    var y = e.clientY + pad;
    var w = tt.offsetWidth || 200;
    var h = tt.offsetHeight || 100;
    if (x + w > window.innerWidth - pad) x = e.clientX - w - pad;
    if (y + h > window.innerHeight - pad) y = e.clientY - h - pad;
    tt.style.left = x + 'px';
    tt.style.top = y + 'px';
}

function _tmHideTooltip() {
    _tmTooltip.classList.remove('visible');
}

// --- Squarified Treemap Layout ---
function _squarify(items, x, y, w, h) {
    var rects = [];
    if (!items.length || w <= 0 || h <= 0) return rects;

    var totalArea = w * h;
    var totalValue = items.reduce(function(s, it) { return s + it.value; }, 0);
    if (totalValue <= 0) return rects;

    var scaled = items.map(function(it) {
        var copy = {};
        for (var k in it) copy[k] = it[k];
        copy.area = (it.value / totalValue) * totalArea;
        return copy;
    });

    _layoutStrip(scaled, rects, x, y, w, h);
    return rects;
}

function _layoutStrip(items, rects, x, y, w, h) {
    if (!items.length) return;
    if (items.length === 1) {
        var it = items[0];
        it.x = x; it.y = y; it.w = w; it.h = h;
        rects.push(it);
        return;
    }

    var isHoriz = w >= h;
    var total = items.reduce(function(s, it) { return s + it.area; }, 0);

    var stripSum = 0;
    var stripItems = [];
    var bestWorst = Infinity;

    for (var i = 0; i < items.length; i++) {
        var testSum = stripSum + items[i].area;
        var testItems = stripItems.concat([items[i]]);
        var worst = _worstAspect(testItems, testSum, isHoriz ? h : w, total, isHoriz ? w : h);

        if (worst <= bestWorst || stripItems.length === 0) {
            bestWorst = worst;
            stripSum = testSum;
            stripItems = testItems;
        } else {
            var stripSize = isHoriz
                ? (stripSum / total) * w
                : (stripSum / total) * h;

            _placeStrip(stripItems, rects, x, y, isHoriz, stripSize, isHoriz ? h : w);

            var remaining = items.slice(i);
            if (isHoriz) {
                _layoutStrip(remaining, rects, x + stripSize, y, w - stripSize, h);
            } else {
                _layoutStrip(remaining, rects, x, y + stripSize, w, h - stripSize);
            }
            return;
        }
    }

    // All items in one strip
    _placeStrip(stripItems, rects, x, y, isHoriz, isHoriz ? w : h, isHoriz ? h : w);
}

function _placeStrip(items, rects, x, y, isHoriz, stripLen, crossLen) {
    var totalArea = items.reduce(function(s, it) { return s + it.area; }, 0);
    var offset = 0;

    items.forEach(function(it) {
        var ratio = it.area / totalArea;
        var len = ratio * crossLen;

        if (isHoriz) {
            it.x = x; it.y = y + offset; it.w = stripLen; it.h = len;
        } else {
            it.x = x + offset; it.y = y; it.w = len; it.h = stripLen;
        }
        rects.push(it);
        offset += len;
    });
}

function _worstAspect(items, stripSum, sideLen, totalArea, mainLen) {
    var stripRealLen = (stripSum / totalArea) * mainLen;
    if (stripRealLen <= 0) return Infinity;
    var worst = 0;
    items.forEach(function(it) {
        var itemLen = (it.area / stripSum) * sideLen;
        if (itemLen <= 0) return;
        var aspect = Math.max(stripRealLen / itemLen, itemLen / stripRealLen);
        if (aspect > worst) worst = aspect;
    });
    return worst;
}

// --- Render Treemap ---
function renderTreemap() {
    if (!currentGraphData || !currentGraphData.nodes.length) return;

    var container = document.getElementById('treemapContainer');
    container.innerHTML = '';
    var rect = container.getBoundingClientRect();
    var W = rect.width;
    var H = rect.height;
    if (W <= 0 || H <= 0) return;

    var metric = document.getElementById('treemapMetric').value;

    // Build metrics
    var inDeg = {};
    var outDeg = {};
    currentGraphData.nodes.forEach(function(n) { inDeg[n.data.id] = 0; outDeg[n.data.id] = 0; });
    currentGraphData.edges.forEach(function(e) {
        if (inDeg[e.data.target] !== undefined) inDeg[e.data.target]++;
        if (outDeg[e.data.source] !== undefined) outDeg[e.data.source]++;
    });

    // Group files by directory
    var dirGroups = {};
    currentGraphData.nodes.forEach(function(n) {
        var id = n.data.id;
        var dir = id.includes('/') ? id.substring(0, id.lastIndexOf('/')) : '.';
        if (!dirGroups[dir]) dirGroups[dir] = { files: [], color: n.data.color };

        var inb = inDeg[id] || 0;
        var outb = outDeg[id] || 0;
        var sizeVal;
        switch (metric) {
            case 'inbound':   sizeVal = inb; break;
            case 'outbound':  sizeVal = outb; break;
            case 'impact':    sizeVal = n.data.impact || 0; break;
            case 'depth':     sizeVal = n.data.depth || 0; break;
            case 'stability': sizeVal = parseFloat(n.data.stability) || 0; break;
            default:          sizeVal = inb + outb; break;
        }
        dirGroups[dir].files.push({
            id: id,
            dir: dir,
            value: Math.max(sizeVal, 0.3),
            sizeValue: sizeVal,
            inbound: inb,
            outbound: outb,
            impact: n.data.impact || 0,
            stability: n.data.stability || 0,
            color: n.data.color
        });
    });

    // Sort dirs by total value
    var dirNames = Object.keys(dirGroups).sort(function(a, b) {
        var sumA = dirGroups[a].files.reduce(function(s, f) { return s + f.value; }, 0);
        var sumB = dirGroups[b].files.reduce(function(s, f) { return s + f.value; }, 0);
        return sumB - sumA;
    });

    // Top-level items: one per directory
    var topItems = dirNames.map(function(dir) {
        return {
            dir: dir,
            value: dirGroups[dir].files.reduce(function(s, f) { return s + f.value; }, 0),
            color: dirGroups[dir].color,
            files: dirGroups[dir].files.sort(function(a, b) { return b.value - a.value; })
        };
    });

    // Layout directories
    var pad = 2;
    var dirRects = _squarify(topItems, pad, pad, W - pad * 2, H - pad * 2);

    // For each directory, sub-layout files
    dirRects.forEach(function(dr) {
        // Directory group container
        var groupEl = document.createElement('div');
        groupEl.className = 'tm-group';
        groupEl.style.cssText = 'left:' + dr.x + 'px;top:' + dr.y + 'px;width:' + dr.w + 'px;height:' + dr.h + 'px;';

        var headerH = 18;
        if (dr.w > 40 && dr.h > 20) {
            var label = document.createElement('div');
            label.className = 'tm-group-label';
            label.textContent = dr.dir;
            label.style.background = 'linear-gradient(to bottom, ' + _adjustColor(dr.color, -30) + ', transparent)';
            groupEl.appendChild(label);
        }

        container.appendChild(groupEl);

        // Sub-layout files
        var innerPad = 1;
        var innerY = dr.y + headerH;
        var innerH = dr.h - headerH;
        if (innerH < 4) return;

        var fileRects = _squarify(dr.files, dr.x + innerPad, innerY + innerPad, dr.w - innerPad * 2, innerH - innerPad * 2);

        fileRects.forEach(function(fr) {
            var cell = document.createElement('div');
            cell.className = 'tm-cell';
            cell.style.cssText = 'left:' + fr.x + 'px;top:' + fr.y + 'px;width:' + fr.w + 'px;height:' + fr.h + 'px;background:' + fr.color + ';';

            // Label if large enough
            if (fr.w > 50 && fr.h > 24) {
                var fname = fr.id.includes('/') ? fr.id.substring(fr.id.lastIndexOf('/') + 1) : fr.id;
                var lbl = document.createElement('div');
                lbl.className = 'tm-cell-label';
                lbl.textContent = fname;
                cell.appendChild(lbl);

                if (fr.h > 38) {
                    var val = document.createElement('div');
                    val.className = 'tm-cell-value';
                    val.textContent = metric === 'stability' ? parseFloat(fr.sizeValue).toFixed(2) : fr.sizeValue;
                    cell.appendChild(val);
                }
            }

            // Tooltip
            cell.addEventListener('mouseenter', function(e) { _tmShowTooltip(e, fr); });
            cell.addEventListener('mousemove', function(e) { _positionTooltip(e); });
            cell.addEventListener('mouseleave', _tmHideTooltip);

            // Click: switch to graph and zoom to node
            cell.addEventListener('click', function() {
                switchView('graph');
                document.getElementById('viewGraph').checked = true;
                setTimeout(function() {
                    if (cy) {
                        var node = cy.getElementById(fr.id);
                        if (node.length) {
                            highlightPaths(fr.id);
                            showBlastRadius(fr.id);
                            cy.animate({ center: { eles: node }, zoom: 1.5 }, { duration: 400 });
                        }
                    }
                }, 100);
            });

            container.appendChild(cell);
        });
    });
}

function _adjustColor(hex, amount) {
    hex = hex.replace('#', '');
    var num = parseInt(hex, 16);
    var r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + amount));
    var g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
    var b = Math.min(255, Math.max(0, (num & 0xff) + amount));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// Re-render views on resize
window.addEventListener('resize', function() {
    if (_currentView === 'treemap') renderTreemap();
});

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

    // No root selected — show prompt
    if (!_treeRootNode) {
        var prompt = document.createElement('div');
        prompt.className = 'tree-empty';
        prompt.innerHTML = '<div class="tree-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="14"/><line x1="12" y1="14" x2="6" y2="20"/><line x1="12" y1="14" x2="18" y2="20"/></svg></div>' +
            '<div class="tree-empty-title">Select a root file</div>' +
            '<div class="tree-empty-desc">Switch to Graph view and click a node, then come back to Tree view to see its dependency tree.</div>';
        container.appendChild(prompt);

        // Also show a clickable file list for convenience
        var fileList = document.createElement('div');
        fileList.className = 'tree-file-picker';
        var sorted = currentGraphData.nodes.slice().sort(function(a, b) {
            return a.data.id.localeCompare(b.data.id);
        });
        sorted.forEach(function(n) {
            var item = document.createElement('div');
            item.className = 'tree-file-picker-item';
            item.textContent = n.data.id;
            item.onclick = function() { _treeRootNode = n.data.id; renderTree(); };
            fileList.appendChild(item);
        });
        container.appendChild(fileList);
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
