// ============================================================
// APP — Main entry point
// Loads graph data, renders the graph, handles upload/directory.
// All other functionality lives in separate module files:
//   state.js, graph-core.js, ui.js, tools.js, analysis.js,
//   simulation.js, story.js, timeline.js, query.js, views.js,
//   exports.js
// ============================================================

// --- Demo graph state ---
let _showingDemo = false;

function loadDemoGraph() {
    if (typeof DEMO_GRAPH_DATA === 'undefined') return;
    _showingDemo = true;
    renderGraph(DEMO_GRAPH_DATA);
    const banner = document.getElementById('demoBanner');
    if (banner) banner.style.display = 'flex';
}

function dismissDemo() {
    _showingDemo = false;
    const banner = document.getElementById('demoBanner');
    if (banner) banner.style.display = 'none';
}

// --- Dev mode configuration ---
async function _applyDevMode() {
    try {
        const res = await fetch('/api/config');
        if (res.ok) {
            const data = await res.json();
            _devMode = !!data.dev_mode;
        }
    } catch (e) { /* Default to production */ }

    // Always show the demo graph immediately as the landing state
    loadDemoGraph();

    if (!_devMode) {
        document.querySelectorAll('.dev-only').forEach(el => el.style.display = 'none');
        // In production mode, don't auto-load — the demo graph IS the landing page.
        // The user will load a real project via Upload or the directory input.
    }
}

// --- Fetch with timeout + structured error handling ---
const _FETCH_TIMEOUT_MS = 60000; // 60 seconds default
const _UPLOAD_TIMEOUT_MS = 120000; // 120 seconds for uploads

function _fetchWithTimeout(url, opts = {}, timeoutMs = _FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...opts, signal: controller.signal })
        .then(r => { clearTimeout(timer); return r; })
        .catch(err => {
            clearTimeout(timer);
            if (err.name === 'AbortError') {
                throw new Error('Request timed out. The operation took too long — try a smaller directory or fewer files.');
            }
            throw err;
        });
}

function _handleApiError(err, fallbackMsg = 'Something went wrong.') {
    if (err && err.message && err.message.startsWith('Request timed out')) {
        showToast(err.message, 6000);
    } else if (err && err.message === 'Failed to fetch') {
        showToast('Cannot reach the server. Is DepGraph running?', 5000);
    } else {
        showToast(fallbackMsg, 5000);
    }
    console.error(fallbackMsg, err);
}

// ============================================================
// COLOR MODE — risk vs language
// ============================================================

const RISK_PALETTE = {
    critical: '#ef4444',
    high:     '#f97316',
    warning:  '#eab308',
    normal:   '#3b82f6',
    entry:    '#22c55e',
    system:   '#6b7280',
};
const RISK_LABELS = {
    critical: 'Critical / God file',
    high:     'High influence',
    warning:  'High dependency',
    normal:   'Normal',
    entry:    'Entry point / leaf',
    system:   'System / external',
};

let _colorMode = 'risk';  // 'risk', 'directory', or 'churn'
let _churnData = null;     // cached churn API response
let _churnLoading = false;

// Heat gradient for churn: low (cool blue) → mid (yellow) → high (hot red)
function _churnColor(score) {
    // score 0–1  →  #3b82f6 (blue) → #eab308 (yellow) → #ef4444 (red)
    if (score <= 0.5) {
        const t = score / 0.5;
        return _lerpColor('#3b82f6', '#eab308', t);
    }
    const t = (score - 0.5) / 0.5;
    return _lerpColor('#eab308', '#ef4444', t);
}

function _lerpColor(a, b, t) {
    const pa = [parseInt(a.slice(1,3),16), parseInt(a.slice(3,5),16), parseInt(a.slice(5,7),16)];
    const pb = [parseInt(b.slice(1,3),16), parseInt(b.slice(3,5),16), parseInt(b.slice(5,7),16)];
    const r = Math.round(pa[0] + (pb[0]-pa[0]) * t);
    const g = Math.round(pa[1] + (pb[1]-pa[1]) * t);
    const bl = Math.round(pa[2] + (pb[2]-pa[2]) * t);
    return '#' + [r,g,bl].map(c => c.toString(16).padStart(2,'0')).join('');
}

function _fetchChurnData() {
    if (_churnData || _churnLoading) return Promise.resolve(_churnData);
    // Upload mode: no git history available
    if (typeof currentMode !== 'undefined' && currentMode === 'upload') {
        _churnData = { files: {}, is_git: false, period: 'Upload via GitHub URL to see churn data' };
        return Promise.resolve(_churnData);
    }
    // GitHub mode: churn comes bundled with the clone response — don't fetch separately
    if (typeof currentMode !== 'undefined' && currentMode === 'github') {
        return Promise.resolve(_churnData);
    }
    // Local directory mode: fetch from the server
    _churnLoading = true;
    var dir = (typeof _lastLoadedDir !== 'undefined' && _lastLoadedDir) ? _lastLoadedDir : '.';
    return _fetchWithTimeout('/api/churn?dir=' + encodeURIComponent(dir))
        .then(r => r.json())
        .then(data => { _churnData = data; _churnLoading = false; return data; })
        .catch(err => { _churnLoading = false; console.error('Churn fetch failed', err); return null; });
}

function changeColorMode(mode) {
    console.log('[DepGraph] changeColorMode:', mode, 'churnData:', !!_churnData, 'cy:', !!cy);
    _colorMode = mode;
    // Re-render tree view if active
    if (_currentView === 'tree') renderTree();
    if (!cy || !currentGraphData) return;

    if (mode === 'churn' && !_churnData) {
        console.log('[DepGraph] Churn mode: no data yet, fetching…');
        _fetchChurnData().then(data => {
            console.log('[DepGraph] Churn fetch result:', !!data, data && data.is_git, data && Object.keys(data.files || {}).length);
            if (data && _colorMode === 'churn') _applyChurnColors();
        });
        return; // colors will be applied after fetch
    }

    // Only swap colors — sizes stay the same so the graph doesn't jump
    cy.batch(() => {
        cy.nodes().forEach(n => {
            if (mode === 'risk') {
                const riskColor = n.data('risk_color') || RISK_PALETTE[n.data('risk')] || RISK_PALETTE.normal;
                n.data('color', riskColor);
            } else if (mode === 'churn') {
                _applyChurnColorToNode(n);
            } else {
                n.data('color', n.data('dir_color') || n.data('color'));
            }
        });
    });

    // Update the legend
    buildColorKey(currentGraphData.nodes);
}

function _applyChurnColors() {
    if (!cy || !_churnData) { console.warn('[DepGraph] _applyChurnColors: no cy or churnData'); return; }
    var matched = 0, total = 0;
    cy.batch(function() {
        cy.nodes().forEach(function(n) {
            total++;
            if (_churnData.files && _churnData.files[n.data('id')]) matched++;
            _applyChurnColorToNode(n);
        });
    });
    console.log('[DepGraph] Churn applied: ' + matched + '/' + total + ' nodes matched. Sample IDs:', cy.nodes().slice(0,3).map(function(n){return n.data('id');}));
    console.log('[DepGraph] Sample churn keys:', Object.keys(_churnData.files || {}).slice(0, 3));
    buildColorKey(currentGraphData.nodes);
}

function _applyChurnColorToNode(n) {
    if (!_churnData || !_churnData.files) {
        n.data('color', '#6b7280'); // grey if no data
        return;
    }
    const fileInfo = _churnData.files[n.data('id')];
    if (fileInfo) {
        n.data('churn_score', fileInfo.churn_score);
        n.data('churn_commits', fileInfo.commits);
        n.data('churn_recent', fileInfo.recent);
        n.data('churn_authors', fileInfo.authors);
        n.data('churn_last_date', fileInfo.last_date);
        n.data('color', _churnColor(fileInfo.churn_score));
    } else {
        n.data('churn_score', 0);
        n.data('color', '#6b7280'); // grey — not in git or no commits
    }
}

function buildColorKey(nodes) {
    const list = document.getElementById('folderKeyList');
    const keyEl = document.getElementById('folderColorKey');
    list.innerHTML = '';

    if (_colorMode === 'risk') {
        // Risk legend
        const riskCounts = {};
        nodes.forEach(n => {
            const r = n.data.risk || 'normal';
            riskCounts[r] = (riskCounts[r] || 0) + 1;
        });
        const order = ['critical', 'high', 'warning', 'normal', 'entry', 'system'];
        order.forEach(r => {
            const cnt = riskCounts[r];
            if (!cnt) return;
            const entry = document.createElement('div');
            entry.className = 'folder-key-entry';
            entry.innerHTML = `<span class="folder-key-dot" style="background:${RISK_PALETTE[r]};"></span> ${RISK_LABELS[r]} (${cnt})`;
            list.appendChild(entry);
        });
        keyEl.style.display = order.some(r => riskCounts[r]) ? 'flex' : 'none';
    } else if (_colorMode === 'churn') {
        // Churn heat-map legend — gradient bar + labels
        if (!_churnData || !_churnData.is_git) {
            const msg = document.createElement('div');
            msg.className = 'folder-key-entry';
            msg.style.fontSize = '0.75rem';
            if (!_churnData) {
                msg.textContent = 'Loading churn data…';
            } else if (_churnData.period) {
                msg.textContent = _churnData.period; // custom message like "Link a GitHub repo..."
            } else {
                msg.textContent = 'Not a git repository';
            }
            list.appendChild(msg);
            keyEl.style.display = 'flex';
        } else {
            // Gradient bar
            const gradBar = document.createElement('div');
            gradBar.style.cssText = 'height:12px;border-radius:6px;margin:4px 0 6px;background:linear-gradient(to right,#3b82f6,#eab308,#ef4444);';
            list.appendChild(gradBar);
            const labelRow = document.createElement('div');
            labelRow.style.cssText = 'display:flex;justify-content:space-between;font-size:0.7rem;opacity:0.7;';
            labelRow.innerHTML = '<span>Low churn</span><span>High churn</span>';
            list.appendChild(labelRow);

            // Period info
            if (_churnData.period) {
                const period = document.createElement('div');
                period.className = 'folder-key-entry';
                period.style.opacity = '0.7';
                period.style.fontSize = '0.7rem';
                period.textContent = _churnData.period;
                list.appendChild(period);
            }

            // Top churners
            const fileEntries = Object.entries(_churnData.files).sort((a,b) => b[1].churn_score - a[1].churn_score).slice(0, 5);
            if (fileEntries.length) {
                const header = document.createElement('div');
                header.className = 'folder-key-entry';
                header.style.fontWeight = '600';
                header.style.marginTop = '6px';
                header.textContent = 'Hottest files';
                list.appendChild(header);
                fileEntries.forEach(([path, info]) => {
                    const entry = document.createElement('div');
                    entry.className = 'folder-key-entry';
                    const shortPath = path.length > 30 ? '…' + path.slice(-28) : path;
                    entry.innerHTML = `<span class="folder-key-dot" style="background:${_churnColor(info.churn_score)};"></span> ${shortPath} <span style="opacity:0.6;font-size:0.7rem">${info.commits}c ${info.recent}r</span>`;
                    entry.style.cursor = 'pointer';
                    entry.onclick = () => { if (cy) { const n = cy.getElementById(path); if (n.length) cy.animate({ center: { eles: n }, zoom: 1.5 }, { duration: 400 }); } };
                    list.appendChild(entry);
                });
            }
            keyEl.style.display = 'flex';
        }
    } else {
        // Directory legend — group by folder
        const dirMap = {};
        nodes.forEach(n => {
            const id = n.data ? n.data.id : n.id;
            const color = n.data ? (n.data.dir_color || n.data.color) : '#6b7280';
            const dir = id.includes('/') ? id.substring(0, id.lastIndexOf('/')) : '.';
            if (!dirMap[dir]) dirMap[dir] = { color, count: 0 };
            dirMap[dir].count++;
        });
        const dirs = Object.keys(dirMap).sort();
        dirs.forEach(dir => {
            const entry = document.createElement('div');
            entry.className = 'folder-key-entry';
            entry.innerHTML = `<span class="folder-key-dot" style="background:${dirMap[dir].color};"></span> ${dir} (${dirMap[dir].count})`;
            list.appendChild(entry);
        });
        keyEl.style.display = dirs.length ? 'flex' : 'none';
    }
}

// ============================================================
// MAIN RENDER — with virtual scrolling for large file lists
// ============================================================

function renderGraph(data) {
    currentGraphData = data;

    // If this is real data (not the demo), dismiss the demo banner
    if (!data._isDemo) dismissDemo();

    // Reset to graph view when new data loads
    if (_currentView !== 'graph') {
        document.getElementById('viewGraph').checked = true;
        switchView('graph');
    }

    const emptyState = document.getElementById('emptyState');
    emptyState.style.display = (!data.nodes || !data.nodes.length) ? 'block' : 'none';

    // Cycles
    const cyclesHeader = document.getElementById('cycles-header');
    const cyclesList = document.getElementById('cycles-list');
    const warning = document.getElementById('cycleWarning');
    if (data.has_cycles) {
        warning.style.display = 'flex';
        cyclesHeader.style.display = '';
        cyclesList.innerHTML = '';
        (data.cycles || []).forEach((cycle, i) => {
            const card = document.createElement('div');
            card.className = 'cycle-card';
            card.innerHTML = `<div class="cycle-card-title">Cycle ${i + 1} &middot; ${cycle.length} files</div>`;
            cycle.forEach(nid => {
                const row = document.createElement('div');
                row.className = 'cycle-card-node';
                row.textContent = nid;
                row.onclick = () => { const n = cy.getElementById(nid); if (n.length) cy.animate({ center: { eles: n }, zoom: 1.5 }, { duration: 400 }); };
                card.appendChild(row);
            });
            cyclesList.appendChild(card);
        });
    } else { warning.style.display = 'none'; cyclesHeader.style.display = 'none'; cyclesList.innerHTML = ''; }

    // Reset fisheye if active before destroying graph
    if (_fisheye.active) {
        _fisheye.active = false;
        _fisheye.restoreData = null;
        const fishBtn = document.getElementById('fisheyeToggle');
        if (fishBtn) fishBtn.classList.remove('active');
    }

    if (cy) cy.destroy();

    // --- Always start in flat files view (no auto-collapse) ---
    _compound.active = false;
    _compound.raw = null;
    _compound.collapsed = new Set();

    // If churn data came bundled (GitHub clone), use it directly; otherwise reset
    if (data.churn && data.churn.files) {
        _churnData = data.churn;
        _churnLoading = false;
        console.log('[DepGraph] Churn bundled in response:', Object.keys(data.churn.files).length, 'files');
    } else {
        _churnData = null;
        _churnLoading = false;
    }

    // Enrich node data: store original language color, apply risk if active
    const enrichedNodes = data.nodes.map(n => {
        const d = { ...n.data, label: n.data.id };
        // dir_color comes from the server; fall back to the original assigned color
        if (!d.dir_color) d.dir_color = d.color;
        if (_colorMode === 'risk') {
            d.color = d.risk_color || RISK_PALETTE[d.risk] || RISK_PALETTE.normal;
        } else if (_colorMode === 'churn') {
            // Apply churn color immediately if data is available
            if (_churnData && _churnData.files && _churnData.files[d.id]) {
                d.color = _churnColor(_churnData.files[d.id].churn_score);
            } else {
                d.color = '#6b7280';
            }
        }
        return { group: 'nodes', data: d };
    });

    // Fetch churn data if not bundled
    if (!_churnData) {
        _fetchChurnData().then(function(result) {
            if (result && _colorMode === 'churn') _applyChurnColors();
        });
    }

    const elements = [...enrichedNodes, ...data.edges];
    _cInitCy(elements, _normalStyles());
    _cBindNormalHandlers();
    // Escape handled by global shortcut system below

    // Attach minimap listeners
    attachMinimapListeners();

    // Show/hide the scope toggle and sync radio state
    pdUpdateToggle();
    const pdRadio = document.getElementById(_compound.active ? 'pdViewDirs' : 'pdViewFiles');
    if (pdRadio) pdRadio.checked = true;

    // Show graph status bar, path hint, and color legend
    if (data.nodes && data.nodes.length) {
        document.getElementById('graphStatusBar').style.display = 'flex';
        document.getElementById('pathHint').style.display = 'block';
        if (!_compound.active) buildColorKey(data.nodes);
        updatePathDatalist();
    }

    // --- Ref list (grouped by directory, collapsible) ---
    const refList = document.getElementById('ref-list');
    refList.innerHTML = '';
    const nodeMap = {};
    data.nodes.forEach(n => { nodeMap[n.data.id] = n.data; });
    const inDeg = {};
    data.nodes.forEach(n => inDeg[n.data.id] = 0);
    data.edges.forEach(e => { if (inDeg[e.data.target] !== undefined) inDeg[e.data.target]++; });
    const sorted = data.nodes.map(n => ({ id: n.data.id, count: inDeg[n.data.id], risk: n.data.risk || 'normal' })).sort((a, b) => b.count - a.count);
    document.getElementById('nodeCountBadge').textContent = sorted.length;

    // Max ref count for proportional bars
    const _maxRefCount = sorted.length ? sorted[0].count : 1;

    // Track per-item checkbox state across re-renders
    const _refChecked = {};
    sorted.forEach(item => { _refChecked[item.id] = true; });

    // Risk → CSS class mapping for file list
    const _riskCssMap = { critical: 'god', high: 'god', warning: 'orphan', entry: 'orphan' };

    // --- File type icon helper ---
    const _fileTypeIcons = {
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
    function _getFileExt(id) {
        const dot = id.lastIndexOf('.');
        return dot >= 0 ? id.substring(dot + 1).toLowerCase() : '';
    }

    function _buildRefRow(item) {
        const riskCls = _riskCssMap[item.risk] || '';
        const div = document.createElement('div');
        div.className = 'list-row ref-dir-file-row';
        div.dataset.fileid = item.id;
        const left = document.createElement('div');
        left.className = 'list-row-left';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = _refChecked[item.id] !== false; cb.title = 'Toggle visibility';
        left.appendChild(cb);

        // File type icon badge
        const ext = _getFileExt(item.id);
        const iconInfo = _fileTypeIcons[ext];
        const badge = document.createElement('span');
        badge.className = 'ref-file-type-badge';
        if (iconInfo) {
            badge.textContent = iconInfo.label;
            badge.style.background = iconInfo.bg;
            if (iconInfo.color) badge.style.color = iconInfo.color;
        } else {
            badge.textContent = ext.substring(0, 2).toUpperCase() || '?';
            badge.style.background = '#6b7280';
        }
        left.appendChild(badge);

        // Risk dot (smaller, secondary)
        const riskDot = document.createElement('span');
        riskDot.className = 'ref-risk-dot';
        riskDot.style.background = RISK_PALETTE[item.risk] || RISK_PALETTE.normal;
        riskDot.title = item.risk;
        left.appendChild(riskDot);

        // File name with expand-on-hover
        const name = document.createElement('span');
        name.className = 'file-name ref-file-name-hover' + (riskCls ? ' ' + riskCls : '');
        const baseName = item.id.includes('/') ? item.id.split('/').pop() : item.id;
        name.textContent = baseName;
        name.title = item.id;
        left.appendChild(name);

        // Right side: mini bar + count pill
        const right = document.createElement('div');
        right.className = 'ref-row-right';

        // Inline reference bar
        const barWrap = document.createElement('div');
        barWrap.className = 'ref-bar-wrap';
        const bar = document.createElement('div');
        bar.className = 'ref-bar';
        const pct = _maxRefCount > 0 ? (item.count / _maxRefCount) * 100 : 0;
        bar.style.width = pct + '%';
        bar.style.background = RISK_PALETTE[item.risk] || RISK_PALETTE.normal;
        barWrap.appendChild(bar);
        right.appendChild(barWrap);

        const pill = document.createElement('span');
        pill.className = 'count-pill';
        pill.textContent = item.count;
        right.appendChild(pill);

        div.appendChild(left);
        div.appendChild(right);
        cb.onchange = (e) => { _refChecked[item.id] = e.target.checked; const n = cy.getElementById(item.id); if (n.length) n.style('display', e.target.checked ? 'element' : 'none'); };
        name.onclick = () => { const n = cy.getElementById(item.id); if (n.length) cy.animate({ center: { eles: n }, zoom: 1.5 }, { duration: 400 }); };
        return div;
    }

    // Group items by directory
    const dirGroups = {};
    sorted.forEach(item => {
        const lastSlash = item.id.lastIndexOf('/');
        const dir = lastSlash >= 0 ? item.id.substring(0, lastSlash) : '.';
        if (!dirGroups[dir]) dirGroups[dir] = [];
        dirGroups[dir].push(item);
    });

    // Sort directories: by total refs descending, then alphabetically
    let dirOrder = Object.keys(dirGroups).sort((a, b) => {
        const sumA = dirGroups[a].reduce((s, i) => s + i.count, 0);
        const sumB = dirGroups[b].reduce((s, i) => s + i.count, 0);
        return sumB - sumA || a.localeCompare(b);
    });

    // Restore user's manual drag order if available
    if (window._refDirManualOrder && window._refDirManualOrder.length) {
        const manualSet = new Set(window._refDirManualOrder);
        const ordered = window._refDirManualOrder.filter(d => dirGroups[d]);
        const remaining = dirOrder.filter(d => !manualSet.has(d));
        dirOrder = [...ordered, ...remaining];
    }

    // Persist collapsed state across graph reloads
    if (!window._refDirCollapsed) window._refDirCollapsed = {};

    // --- Risk summary helper for directory headers ---
    function _buildRiskSummary(items) {
        const counts = {};
        items.forEach(i => { counts[i.risk] = (counts[i.risk] || 0) + 1; });
        const wrap = document.createElement('span');
        wrap.className = 'ref-risk-summary';
        ['critical', 'high', 'warning', 'normal', 'entry'].forEach(r => {
            if (!counts[r]) return;
            for (let i = 0; i < Math.min(counts[r], 5); i++) {
                const dot = document.createElement('span');
                dot.className = 'ref-risk-summary-dot';
                dot.style.background = RISK_PALETTE[r];
                dot.title = counts[r] + ' ' + r;
                wrap.appendChild(dot);
            }
            if (counts[r] > 5) {
                const more = document.createElement('span');
                more.className = 'ref-risk-summary-more';
                more.textContent = '+' + (counts[r] - 5);
                more.title = counts[r] + ' ' + r;
                wrap.appendChild(more);
            }
        });
        return wrap;
    }

    // Collapse/expand all toolbar
    const refToolbar = document.createElement('div');
    refToolbar.className = 'ref-dir-toolbar';
    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'btn btn-ghost ref-dir-toggle-all';
    collapseBtn.title = 'Collapse all directories';
    collapseBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg> Collapse all';
    collapseBtn.onclick = function() {
        dirOrder.forEach(function(d) { window._refDirCollapsed[d] = true; });
        document.querySelectorAll('.ref-dir-header').forEach(function(h) { h.classList.add('collapsed'); if (h.nextElementSibling && h.nextElementSibling.classList.contains('ref-dir-body')) h.nextElementSibling.style.display = 'none'; });
    };
    const expandBtn = document.createElement('button');
    expandBtn.className = 'btn btn-ghost ref-dir-toggle-all';
    expandBtn.title = 'Expand all directories';
    expandBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg> Expand all';
    expandBtn.onclick = function() {
        dirOrder.forEach(function(d) { window._refDirCollapsed[d] = false; });
        document.querySelectorAll('.ref-dir-header').forEach(function(h) { h.classList.remove('collapsed'); if (h.nextElementSibling && h.nextElementSibling.classList.contains('ref-dir-body')) h.nextElementSibling.style.display = ''; });
    };
    refToolbar.appendChild(collapseBtn);
    refToolbar.appendChild(expandBtn);
    refList.appendChild(refToolbar);

    // --- Build directory groups ---
    dirOrder.forEach(function(dir) {
        const items = dirGroups[dir];
        const totalRefs = items.reduce(function(s, i) { return s + i.count; }, 0);
        const isCollapsed = window._refDirCollapsed[dir] === true;

        // Directory group header
        const header = document.createElement('div');
        header.className = 'ref-dir-header' + (isCollapsed ? ' collapsed' : '');
        header.dataset.dir = dir;
        header.draggable = true;

        const headerLeft = document.createElement('div');
        headerLeft.className = 'ref-dir-header-left';
        // Drag handle
        headerLeft.innerHTML = '<span class="ref-dir-drag-handle" title="Drag to reorder">⠿</span>'
            + '<svg class="ref-dir-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
            + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;flex-shrink:0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
            + '<span class="ref-dir-name">' + _escapeHtml(dir) + '</span>';
        header.appendChild(headerLeft);

        const headerRight = document.createElement('div');
        headerRight.className = 'ref-dir-header-right';

        // Risk summary dots
        headerRight.appendChild(_buildRiskSummary(items));

        // Focus directory button
        const focusBtn = document.createElement('button');
        focusBtn.className = 'ref-dir-focus-btn';
        focusBtn.title = 'Focus this directory on graph';
        focusBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>';
        focusBtn.onclick = function(e) {
            e.stopPropagation();
            if (!cy) return;
            // Dim all nodes, then highlight this directory's files
            cy.batch(function() {
                cy.nodes().style('opacity', 0.15);
                cy.edges().style('opacity', 0.08);
                items.forEach(function(item) {
                    var n = cy.getElementById(item.id);
                    if (n.length) {
                        n.style('opacity', 1);
                        n.connectedEdges().style('opacity', 0.7);
                    }
                });
            });
            // Fit to the focused nodes
            var focusedNodes = cy.nodes().filter(function(n) { return parseFloat(n.style('opacity')) > 0.5; });
            if (focusedNodes.length) cy.animate({ fit: { eles: focusedNodes, padding: 60 } }, { duration: 400 });
            showToast('Focused on ' + dir + ' — press Esc to clear');
        };
        headerRight.appendChild(focusBtn);

        const fileCount = document.createElement('span');
        fileCount.className = 'ref-dir-file-count';
        fileCount.textContent = items.length + ' file' + (items.length !== 1 ? 's' : '');
        headerRight.appendChild(fileCount);

        const pill = document.createElement('span');
        pill.className = 'count-pill';
        pill.textContent = totalRefs;
        headerRight.appendChild(pill);

        header.appendChild(headerRight);

        // Collapse/expand on click (but not on drag handle or focus button)
        header.addEventListener('click', function(e) {
            if (e.target.closest('.ref-dir-focus-btn') || e.target.closest('.ref-dir-drag-handle')) return;
            var dirKey = this.dataset.dir;
            var body = this.nextElementSibling;
            var nowCollapsed = !this.classList.contains('collapsed');
            this.classList.toggle('collapsed', nowCollapsed);
            window._refDirCollapsed[dirKey] = nowCollapsed;
            if (body && body.classList.contains('ref-dir-body')) body.style.display = nowCollapsed ? 'none' : '';
        });

        // --- Drag-to-reorder ---
        header.addEventListener('dragstart', function(e) {
            e.dataTransfer.setData('text/plain', dir);
            e.dataTransfer.effectAllowed = 'move';
            this.classList.add('ref-dir-dragging');
        });
        header.addEventListener('dragend', function() {
            this.classList.remove('ref-dir-dragging');
            document.querySelectorAll('.ref-dir-drop-above').forEach(function(el) { el.classList.remove('ref-dir-drop-above'); });
        });
        header.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this.classList.add('ref-dir-drop-above');
        });
        header.addEventListener('dragleave', function() {
            this.classList.remove('ref-dir-drop-above');
        });
        header.addEventListener('drop', function(e) {
            e.preventDefault();
            this.classList.remove('ref-dir-drop-above');
            var srcDir = e.dataTransfer.getData('text/plain');
            var dstDir = this.dataset.dir;
            if (srcDir === dstDir) return;
            // Move the dragged header+body before this header
            var srcHeader = refList.querySelector('.ref-dir-header[data-dir="' + CSS.escape(srcDir) + '"]');
            if (!srcHeader) return;
            var srcBody = srcHeader.nextElementSibling;
            refList.insertBefore(srcHeader, this);
            if (srcBody && srcBody.classList.contains('ref-dir-body')) refList.insertBefore(srcBody, this);
            // Save manual order
            var headers = refList.querySelectorAll('.ref-dir-header');
            window._refDirManualOrder = Array.from(headers).map(function(h) { return h.dataset.dir; });
        });

        refList.appendChild(header);

        // Directory group body (file rows)
        var body = document.createElement('div');
        body.className = 'ref-dir-body';
        body.dataset.dir = dir;
        body.style.display = isCollapsed ? 'none' : '';
        items.forEach(function(item) { body.appendChild(_buildRefRow(item)); });
        refList.appendChild(body);
    });

    // --- Search/filter for ref list ---
    const refSearchInput = document.getElementById('refSearchInput');
    if (refSearchInput) {
        refSearchInput.value = '';
        refSearchInput.oninput = function() {
            const q = this.value.toLowerCase().trim();
            refList.querySelectorAll('.ref-dir-header').forEach(function(header) {
                const body = header.nextElementSibling;
                if (!body || !body.classList.contains('ref-dir-body')) return;
                const rows = body.querySelectorAll('.ref-dir-file-row');
                let anyVisible = false;
                rows.forEach(function(row) {
                    const fid = row.dataset.fileid || '';
                    const match = !q || fid.toLowerCase().includes(q);
                    row.style.display = match ? '' : 'none';
                    if (match) anyVisible = true;
                });
                // Show/hide directory header based on whether any files match
                header.style.display = (!q || anyVisible) ? '' : 'none';
                body.style.display = (!q || anyVisible) ? '' : 'none';
                // Auto-expand matching directories when searching
                if (q && anyVisible) {
                    header.classList.remove('collapsed');
                }
            });
        };
    }

    // --- Unused (virtual-scrolled for large lists) ---
    const ul = document.getElementById('unused-list');
    ul.innerHTML = '';
    const unused = data.unused_files || [];
    document.getElementById('unusedCountBadge').textContent = unused.length;

    function _buildUnusedRow(fid) {
        const d = document.createElement('div');
        d.className = 'metric-row clickable';
        d.innerHTML = `<span class="metric-label">${fid}</span><span class="badge badge-red">0 refs</span>`;
        d.onclick = () => { const n = cy.getElementById(fid); if (n.length) cy.animate({ center: { eles: n }, zoom: 1.5 }, { duration: 400 }); };
        return d;
    }

    if (!unused.length) {
        ul.innerHTML = '<div class="metric-row"><span class="metric-label" style="color:var(--success);">All files are referenced</span></div>';
    } else if (unused.length <= VIRTUAL_THRESHOLD) {
        unused.forEach(fid => ul.appendChild(_buildUnusedRow(fid)));
    } else {
        const UROW_H = 30;
        ul.style.position = 'relative';
        ul.style.overflow = 'auto';
        if (!ul.style.maxHeight) ul.style.maxHeight = '60vh';

        const uSpacer = document.createElement('div');
        uSpacer.style.height = (unused.length * UROW_H) + 'px';
        uSpacer.style.position = 'relative';
        ul.appendChild(uSpacer);

        const uViewport = document.createElement('div');
        uViewport.style.position = 'absolute';
        uViewport.style.left = '0';
        uViewport.style.right = '0';
        uViewport.style.willChange = 'transform';
        uSpacer.appendChild(uViewport);

        let _uLastStart = -1, _uLastEnd = -1;

        function _renderVisibleUnusedRows() {
            const scrollTop = ul.scrollTop;
            const viewH = ul.clientHeight;
            const start = Math.max(0, Math.floor(scrollTop / UROW_H) - BUFFER);
            const end = Math.min(unused.length, Math.ceil((scrollTop + viewH) / UROW_H) + BUFFER);
            if (start === _uLastStart && end === _uLastEnd) return;
            _uLastStart = start;
            _uLastEnd = end;
            uViewport.style.transform = 'translateY(' + (start * UROW_H) + 'px)';
            uViewport.innerHTML = '';
            for (let i = start; i < end; i++) {
                uViewport.appendChild(_buildUnusedRow(unused[i]));
            }
        }

        _renderVisibleUnusedRows();
        ul.addEventListener('scroll', _renderVisibleUnusedRows, { passive: true });
    }

    // --- Coupling ---
    const cl = document.getElementById('coupling-list');
    cl.innerHTML = '';
    const coupling = data.coupling || [];
    if (!coupling.length) cl.innerHTML = '<div class="metric-row"><span class="metric-label">No cross-directory edges</span></div>';
    else coupling.forEach(c => {
        const d = document.createElement('div');
        d.className = 'metric-row';
        d.innerHTML = `<span class="metric-label">${c.dir1} \u2194 ${c.dir2}</span><span class="badge ${c.score > 0.3 ? 'badge-red' : c.score > 0.1 ? 'badge-yellow' : 'badge-green'}">${c.cross_edges} (${c.score})</span>`;
        cl.appendChild(d);
    });

    // Reset tree state so the file picker menu shows on new data
    _treeRootNode = null;
    _treeSearchQuery = '';
    try { renderTree(); } catch(e) { console.warn('Tree pre-render error:', e); }

    // Run post-render hooks (registered by other modules)
    _postRenderHooks.forEach(fn => { try { fn(data); } catch(e) { console.warn('Post-render hook error:', e); } });
}

// ============================================================
// UPLOAD & GRAPH LOADING (with timeout support)
// ============================================================

function handleZipSelect(e) { const f = e.target.files[0]; if (!f) return; currentUploadedFile = f; uploadZip(); e.target.value = ''; }

function updateGraph() {
    // If we have an upload token (from upload or GitHub clone), re-filter
    // via /api/graph?upload_token=... instead of re-uploading/re-cloning.
    if (currentUploadToken && (currentMode === 'github' || currentMode === 'upload')) {
        refilterGraph();
    } else if (currentMode === 'github' && _lastGitHubRepo) {
        loadFromGitHub();
    } else if (currentMode === 'upload' && currentUploadedFile) {
        uploadZip();
    } else {
        loadGraph();
    }
}

function refilterGraph() {
    document.getElementById('loading').classList.add('active');
    const params = { upload_token: currentUploadToken, ...getFilterValues() };
    _fetchWithTimeout('/api/graph?' + new URLSearchParams(params))
        .then(r => r.json()).then(d => {
            if (d.error) {
                showToast('Error: ' + (d.suggestion || d.error), 4000);
                document.getElementById('loading').classList.remove('active');
            } else {
                try {
                    currentUploadToken = d.upload_token || currentUploadToken;
                    renderGraph(d);
                    showDetectedLanguages(d.detected);
                    showDepthWarnings(d);
                } catch (renderErr) {
                    console.error('Render error after re-filter:', renderErr);
                }
            }
        }).catch(err => {
            _handleApiError(err, 'Failed to re-filter graph.');
            document.getElementById('loading').classList.remove('active');
        });
}

let _lastGitHubRepo = '';

function loadFromGitHub() {
    const input = document.getElementById('githubUrlInput');
    const btn = document.getElementById('githubGoBtn');
    const repo = input.value.trim();
    if (!repo) { console.warn('[DepGraph] GitHub: empty repo input'); return; }
    console.log('[DepGraph] GitHub: loading', repo);

    _lastGitHubRepo = repo;
    currentMode = 'github';
    dismissDemo();
    const loadingMsg = document.getElementById('loadingMessage');
    if (loadingMsg) loadingMsg.innerHTML = 'Cloning repository locally…<br><span style="font-size:0.72rem;opacity:0.7;">Your code stays on your machine. Nothing is sent to external servers.</span>';
    document.getElementById('loading').classList.add('active');
    btn.querySelector('span').textContent = 'Cloning…';
    btn.disabled = true;

    _fetchWithTimeout('/api/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._csrfHeaders() },
        body: JSON.stringify({ repo: repo, filters: getFilterValues() }),
    }, 200000) // 200s — clones can be slow
        .then(r => r.json())
        .then(d => {
            btn.querySelector('span').textContent = 'Go';
            btn.disabled = false;
            if (loadingMsg) loadingMsg.innerHTML = '';
            if (d.error) {
                showToast('Error: ' + (d.suggestion || d.error), 5000);
                document.getElementById('loading').classList.remove('active');
                if (!currentGraphData) loadDemoGraph();
            } else {
                try {
                    currentUploadToken = d.upload_token || null;
                    renderGraph(d);  // churn data is extracted inside renderGraph
                    showDetectedLanguages(d.detected);
                    showDepthWarnings(d);
                } catch (renderErr) {
                    console.error('Render error after GitHub clone:', renderErr);
                }
            }
        })
        .catch(err => {
            btn.querySelector('span').textContent = 'Go';
            btn.disabled = false;
            if (loadingMsg) loadingMsg.innerHTML = '';
            _handleApiError(err, 'Failed to load from GitHub.');
            document.getElementById('loading').classList.remove('active');
            if (!currentGraphData) loadDemoGraph();
        });
}

function uploadZip() {
    if (!currentUploadedFile) return;
    currentMode = 'upload';
    const fd = new FormData(); fd.append('file', currentUploadedFile);
    for (const [k, v] of Object.entries(getFilterValues())) fd.append(k, v);
    document.getElementById('loading').classList.add('active');
    _fetchWithTimeout('/api/upload', { method: 'POST', headers: _csrfHeaders(), body: fd }, _UPLOAD_TIMEOUT_MS)
        .then(r => r.json()).then(d => {
            if (d.error) { showToast('Error: ' + (d.suggestion || d.error), 5000); document.getElementById('loading').classList.remove('active'); }
            else {
                try {
                    currentUploadToken = d.upload_token || null;
                    renderGraph(d);
                    showDetectedLanguages(d.detected);
                    showDepthWarnings(d);
                } catch (renderErr) {
                    console.error('Render error after successful upload:', renderErr);
                    // Don't show "Upload failed" — the upload was fine, just rendering had an issue
                }
            }
        }).catch(err => { _handleApiError(err, 'Upload failed.'); document.getElementById('loading').classList.remove('active'); });
}

let _selectedLang = 'auto';

function selectLang(btn) {
    _selectedLang = btn.dataset.lang;
    document.querySelectorAll('.lang-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('langLabel').textContent = btn.textContent;
    document.getElementById('langDropdown').removeAttribute('open');
    if (_showingDemo) {
        showToast('Upload or clone a project first to filter by language.', 3000);
        return;
    }
    updateGraph();
}

function getFilterValues() {
    const m = _selectedLang;
    const common = { hide_system: document.getElementById('hideSystemHeaders').checked, hide_isolated: document.getElementById('hideIsolated').checked, filter_dir: document.getElementById('filterDirInput').value };
    if (m === 'auto') return { mode: 'auto', ...common };
    return { ...common, show_c: m === 'c' || m === 'cpp', show_h: m === 'c' || m === 'cpp', show_cpp: m === 'cpp', show_js: m === 'js', show_py: m === 'py', show_java: m === 'java', show_go: m === 'go', show_rust: m === 'rust', show_cs: m === 'cs', show_swift: m === 'swift', show_ruby: m === 'ruby', show_kotlin: m === 'kotlin', show_scala: m === 'scala', show_php: m === 'php', show_dart: m === 'dart', show_elixir: m === 'elixir' };
}

function showDetectedLanguages(det) {
    const el = document.getElementById('detectedLangs');
    if (!det) { el.style.display = 'none'; return; }
    const langMap = [
        ['has_c', 'C'], ['has_h', 'Headers'], ['has_cpp', 'C++'],
        ['has_js', 'JS/TS'], ['has_py', 'Python'], ['has_java', 'Java'],
        ['has_go', 'Go'], ['has_rust', 'Rust'], ['has_cs', 'C#'],
        ['has_swift', 'Swift'], ['has_ruby', 'Ruby'],
        ['has_kotlin', 'Kotlin'], ['has_scala', 'Scala'],
        ['has_php', 'PHP'], ['has_dart', 'Dart'], ['has_elixir', 'Elixir'],
    ];
    const langs = langMap.filter(([k]) => det[k]).map(([, v]) => v);
    el.textContent = langs.length ? 'Detected: ' + langs.join(', ') : 'No supported files detected';
    el.style.display = '';
}

function loadGraph() {
    currentMode = 'local';
    // Hide demo banner when loading a real graph
    dismissDemo();
    document.getElementById('loading').classList.add('active');
    const dirEl = document.getElementById('dirInput');
    const dir = dirEl ? dirEl.value : '';
    _lastLoadedDir = dir;
    _fetchWithTimeout('/api/graph?' + new URLSearchParams({ dir: dir, ...getFilterValues() }))
        .then(r => r.json()).then(d => {
            if (d.error) {
                showToast('Error: ' + (d.suggestion || d.error), 4000);
                document.getElementById('loading').classList.remove('active');
                // Fall back to demo graph if no real graph loaded yet
                if (!currentGraphData) loadDemoGraph();
            } else {
                try {
                    renderGraph(d);
                    showDetectedLanguages(d.detected);
                    showDepthWarnings(d);
                } catch (renderErr) {
                    console.error('Render error after successful load:', renderErr);
                }
            }
        }).catch(err => {
            _handleApiError(err, 'Failed to load graph.');
            document.getElementById('loading').classList.remove('active');
            // Fall back to demo graph if no real graph loaded yet
            if (!currentGraphData) loadDemoGraph();
        });
}

// ============================================================
// INIT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
    // Dismiss splash: minimum 2 seconds, or when page is fully loaded — whichever comes first
    const splash = document.getElementById('splash');
    if (splash) {
        const start = Date.now();
        const dismiss = () => {
            if (splash.classList.contains('fade-out')) return;
            const elapsed = Date.now() - start;
            const delay = Math.max(0, 2000 - elapsed);
            setTimeout(() => { splash.classList.add('fade-out'); setTimeout(() => splash.remove(), 500); }, delay);
        };
        window.addEventListener('load', dismiss);
        setTimeout(dismiss, 2000);
    }
    _applyDevMode();
});
