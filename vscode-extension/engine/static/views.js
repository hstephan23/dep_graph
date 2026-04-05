/**
 * views.js - View rendering and switching logic
 *
 * This module handles switching between graph, treemap, and matrix views,
 * and contains all the rendering logic for treemap and matrix visualizations.
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
    const tmEl = document.getElementById('treemapContainer');
    const mxEl = document.getElementById('matrixContainer');
    const metricGroup = document.getElementById('treemapMetricGroup');

    // Graph-only overlays: hide when not on graph
    const graphOnly = document.querySelectorAll('#folderColorKey, #graphStatusBar, #pathHint, #minimap');
    const isGraph = view === 'graph';
    graphOnly.forEach(el => el.style.display = isGraph ? '' : 'none');

    const panels = [cyEl, tmEl, mxEl];
    const outgoing = panels.filter(el => el.style.display !== 'none' && el.offsetHeight > 0);

    function _showTarget() {
        // Hide all panels (no opacity tricks — just display)
        cyEl.style.display = 'none';
        tmEl.style.display = 'none';
        mxEl.style.display = 'none';
        metricGroup.style.display = 'none';

        // Show the target view
        if (view === 'treemap') {
            tmEl.style.display = 'block';
            metricGroup.style.display = '';
            renderTreemap();
        } else if (view === 'matrix') {
            mxEl.style.display = 'flex';
            renderMatrix();
        } else {
            cyEl.style.display = '';
            if (cy) cy.resize();
        }
    }

    // If there's a visible outgoing panel, crossfade; otherwise show immediately
    if (outgoing.length > 0) {
        const fadeMs = 150;
        const incoming = view === 'treemap' ? tmEl : view === 'matrix' ? mxEl : cyEl;
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
    if (_currentView === 'matrix') renderMatrix();
});

// ================================================================
// MATRIX VIEW
// ================================================================
function renderMatrix() {
    var container = document.getElementById('matrixContainer');
    container.innerHTML = '';
    if (!currentGraphData || !currentGraphData.nodes.length) return;

    var nodes = currentGraphData.nodes.slice();
    var edges = currentGraphData.edges;

    // Build adjacency set: source -> Set(target)
    var adj = {};
    edges.forEach(function(e) {
        var s = e.data.source, t = e.data.target;
        if (!adj[s]) adj[s] = new Set();
        adj[s].add(t);
    });

    // Sort nodes by directory then filename for cluster visibility
    nodes.sort(function(a, b) {
        var aId = a.data.id, bId = b.data.id;
        var aDir = aId.includes('/') ? aId.substring(0, aId.lastIndexOf('/')) : '';
        var bDir = bId.includes('/') ? bId.substring(0, bId.lastIndexOf('/')) : '';
        if (aDir !== bDir) return aDir.localeCompare(bDir);
        return aId.localeCompare(bId);
    });

    var ids = nodes.map(function(n) { return n.data.id; });
    var colorMap = {};
    nodes.forEach(function(n) { colorMap[n.data.id] = n.data.color; });

    // Pre-compute directory boundaries for separator lines
    var dirs = ids.map(function(id) {
        return id.includes('/') ? id.substring(0, id.lastIndexOf('/')) : '.';
    });
    var dirBoundaries = new Set();
    for (var d = 1; d < dirs.length; d++) {
        if (dirs[d] !== dirs[d - 1]) dirBoundaries.add(d);
    }

    // Build short labels (filename only, disambiguate if needed)
    var shortLabels = {};
    var nameCount = {};
    ids.forEach(function(id) {
        var name = id.includes('/') ? id.substring(id.lastIndexOf('/') + 1) : id;
        nameCount[name] = (nameCount[name] || 0) + 1;
    });
    ids.forEach(function(id) {
        var name = id.includes('/') ? id.substring(id.lastIndexOf('/') + 1) : id;
        shortLabels[id] = nameCount[name] > 1 ? id : name;
    });

    var n = ids.length;

    // ---- Wrapper layout ----
    var wrapper = document.createElement('div');
    wrapper.className = 'matrix-wrapper';

    // ---- Summary stats bar ----
    var stats = document.createElement('div');
    stats.className = 'matrix-stats';
    var edgeCount = edges.length;
    var maxPossible = n * (n - 1);
    var density = maxPossible > 0 ? (edgeCount / maxPossible * 100).toFixed(1) : '0';
    stats.innerHTML =
        '<span class="matrix-stat">' + n + ' files</span>' +
        '<span class="matrix-stat-sep"></span>' +
        '<span class="matrix-stat">' + edgeCount + ' dependencies</span>' +
        '<span class="matrix-stat-sep"></span>' +
        '<span class="matrix-stat">Density: ' + density + '%</span>' +
        '<span class="matrix-stat-sep"></span>' +
        '<span class="matrix-stat matrix-stat-hint">' +
            '<svg width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" rx="2" fill="var(--primary)" opacity="0.85"/></svg>' +
            ' Colored cell = row file imports column file' +
        '</span>' +
        '<span class="matrix-stat-sep"></span>' +
        '<span class="matrix-stat matrix-stat-hint">Click a cell to jump to that edge in the graph</span>';
    wrapper.appendChild(stats);

    // ---- Scrollable grid area ----
    var scrollArea = document.createElement('div');
    scrollArea.className = 'matrix-scroll';

    // Generous cell size — the grid scrolls, so don't over-shrink
    var cellSize = n <= 20 ? 32 : n <= 50 ? 26 : 20;

    var gridW = n * cellSize;
    var gridH = n * cellSize;
    var headerH = Math.min(160, Math.max(80, cellSize * 4));

    // Create canvas for the grid (much faster than DOM for large matrices)
    var canvas = document.createElement('canvas');
    var dpr = window.devicePixelRatio || 1;
    canvas.width = gridW * dpr;
    canvas.height = gridH * dpr;
    canvas.className = 'matrix-canvas';
    canvas.style.width = gridW + 'px';
    canvas.style.height = gridH + 'px';

    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Draw cells
    for (var row = 0; row < n; row++) {
        for (var col = 0; col < n; col++) {
            var x = col * cellSize;
            var y = row * cellSize;

            if (row === col) {
                ctx.fillStyle = getCssVar('--bg-sunken');
                ctx.fillRect(x, y, cellSize, cellSize);
            } else if (adj[ids[row]] && adj[ids[row]].has(ids[col])) {
                var color = colorMap[ids[row]] || '#6366f1';
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.85;
                ctx.fillRect(x, y, cellSize, cellSize);
                ctx.globalAlpha = 1;
            }
        }
    }

    // Draw directory boundary lines
    ctx.strokeStyle = getCssVar('--primary');
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1;
    dirBoundaries.forEach(function(idx) {
        var pos = idx * cellSize;
        ctx.beginPath();
        ctx.moveTo(pos, 0); ctx.lineTo(pos, gridH);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, pos); ctx.lineTo(gridW, pos);
        ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // Draw subtle grid lines
    ctx.strokeStyle = getCssVar('--border');
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 0.5;
    for (var i = 0; i <= n; i++) {
        var p = i * cellSize;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, gridH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(gridW, p); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // ---- Row labels (left side) ----
    var rowLabels = document.createElement('div');
    rowLabels.className = 'matrix-row-labels';
    rowLabels.style.height = gridH + 'px';
    for (var r = 0; r < n; r++) {
        var rl = document.createElement('div');
        rl.className = 'matrix-label matrix-row-label';
        rl.style.height = cellSize + 'px';
        rl.style.lineHeight = cellSize + 'px';
        if (dirBoundaries.has(r)) rl.classList.add('matrix-label-boundary');
        var dot = document.createElement('span');
        dot.className = 'matrix-label-dot';
        dot.style.background = colorMap[ids[r]] || '#6366f1';
        rl.appendChild(dot);
        var span = document.createElement('span');
        span.className = 'matrix-label-text';
        span.textContent = shortLabels[ids[r]];
        span.title = ids[r];
        rl.appendChild(span);
        rowLabels.appendChild(rl);
    }

    // ---- Column labels (top) ----
    var colLabels = document.createElement('div');
    colLabels.className = 'matrix-col-labels';
    colLabels.style.width = gridW + 'px';
    colLabels.style.height = headerH + 'px';
    for (var c = 0; c < n; c++) {
        var cl = document.createElement('div');
        cl.className = 'matrix-label matrix-col-label';
        cl.style.width = cellSize + 'px';
        cl.style.left = (c * cellSize) + 'px';
        cl.style.height = headerH + 'px';
        if (dirBoundaries.has(c)) cl.classList.add('matrix-label-boundary');
        var cspan = document.createElement('span');
        cspan.className = 'matrix-label-text';
        cspan.textContent = shortLabels[ids[c]];
        cspan.title = ids[c];
        cl.appendChild(cspan);
        colLabels.appendChild(cl);
    }

    // ---- Assemble grid layout ----
    var corner = document.createElement('div');
    corner.className = 'matrix-corner';
    corner.style.height = headerH + 'px';
    corner.innerHTML = '<span class="matrix-corner-label">← imports →</span>';

    var topRow = document.createElement('div');
    topRow.className = 'matrix-top-row';
    topRow.appendChild(corner);
    topRow.appendChild(colLabels);

    var bodyRow = document.createElement('div');
    bodyRow.className = 'matrix-body-row';
    bodyRow.appendChild(rowLabels);

    var canvasWrap = document.createElement('div');
    canvasWrap.className = 'matrix-canvas-wrap';
    canvasWrap.appendChild(canvas);
    bodyRow.appendChild(canvasWrap);

    scrollArea.appendChild(topRow);
    scrollArea.appendChild(bodyRow);
    wrapper.appendChild(scrollArea);

    // ---- Hover tooltip & crosshair ----
    var tip = document.createElement('div');
    tip.className = 'matrix-tip';
    wrapper.appendChild(tip);

    var hRow = document.createElement('div');
    hRow.className = 'matrix-highlight-row';
    canvasWrap.appendChild(hRow);
    var hCol = document.createElement('div');
    hCol.className = 'matrix-highlight-col';
    canvasWrap.appendChild(hCol);

    canvas.addEventListener('mousemove', function(e) {
        var rect = canvas.getBoundingClientRect();
        var mx = e.clientX - rect.left;
        var my = e.clientY - rect.top;
        var col = Math.floor(mx / cellSize);
        var row = Math.floor(my / cellSize);
        if (row < 0 || row >= n || col < 0 || col >= n) {
            tip.style.display = 'none';
            hRow.style.display = 'none';
            hCol.style.display = 'none';
            clearLabelHighlights();
            return;
        }

        hRow.style.display = 'block';
        hRow.style.top = (row * cellSize) + 'px';
        hRow.style.height = cellSize + 'px';
        hCol.style.display = 'block';
        hCol.style.left = (col * cellSize) + 'px';
        hCol.style.width = cellSize + 'px';

        highlightLabels(row, col);

        var source = ids[row], target = ids[col];
        var hasDep = adj[source] && adj[source].has(target);
        var hasReverse = adj[target] && adj[target].has(source);

        var html = '<div class="matrix-tip-files">' +
            '<span class="matrix-tip-source">' + _escapeHtml(shortLabels[source]) + '</span>' +
            '<span class="matrix-tip-arrow">' + (hasDep ? '→' : '·') + '</span>' +
            '<span class="matrix-tip-target">' + _escapeHtml(shortLabels[target]) + '</span></div>';

        if (row === col) {
            html += '<div class="matrix-tip-status">Self (diagonal)</div>';
        } else if (hasDep && hasReverse) {
            html += '<div class="matrix-tip-status matrix-tip-mutual">Mutual dependency</div>';
        } else if (hasDep) {
            html += '<div class="matrix-tip-status matrix-tip-yes">Depends on</div>';
        } else {
            html += '<div class="matrix-tip-status matrix-tip-no">No dependency</div>';
        }

        tip.innerHTML = html;
        tip.style.display = 'block';

        var wrapRect = wrapper.getBoundingClientRect();
        var tx = e.clientX - wrapRect.left + 14;
        var ty = e.clientY - wrapRect.top + 14;
        if (tx + 200 > wrapRect.width) tx = e.clientX - wrapRect.left - 200;
        if (ty + 60 > wrapRect.height) ty = e.clientY - wrapRect.top - 60;
        tip.style.left = tx + 'px';
        tip.style.top = ty + 'px';
    });

    canvas.addEventListener('mouseleave', function() {
        tip.style.display = 'none';
        hRow.style.display = 'none';
        hCol.style.display = 'none';
        clearLabelHighlights();
    });

    // Click a cell → switch to graph and focus that edge
    canvas.addEventListener('click', function(e) {
        var rect = canvas.getBoundingClientRect();
        var col = Math.floor((e.clientX - rect.left) / cellSize);
        var row = Math.floor((e.clientY - rect.top) / cellSize);
        if (row < 0 || row >= n || col < 0 || col >= n) return;
        var source = ids[row], target = ids[col];
        var hasDep = adj[source] && adj[source].has(target);
        if (hasDep && cy) {
            document.getElementById('viewGraph').checked = true;
            switchView('graph');
            var srcNode = cy.getElementById(source);
            var tgtNode = cy.getElementById(target);
            if (srcNode.length && tgtNode.length) {
                cy.animate({ fit: { eles: srcNode.union(tgtNode), padding: 80 } }, { duration: 400 });
                setTimeout(function() {
                    highlightPaths(source);
                }, 450);
            }
        }
    });

    function highlightLabels(row, col) {
        var rlc = rowLabels.children;
        var clc = colLabels.children;
        for (var i = 0; i < n; i++) {
            rlc[i].classList.toggle('matrix-label-active', i === row);
            clc[i].classList.toggle('matrix-label-active', i === col);
        }
    }

    function clearLabelHighlights() {
        var rlc = rowLabels.children;
        var clc = colLabels.children;
        for (var i = 0; i < n; i++) {
            rlc[i].classList.remove('matrix-label-active');
            clc[i].classList.remove('matrix-label-active');
        }
    }

    container.appendChild(wrapper);
}

function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
