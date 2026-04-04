// ============================================================
// APP — Main entry point
// Loads graph data, renders the graph, handles upload/directory.
// All other functionality lives in separate module files:
//   state.js, graph-core.js, ui.js, tools.js, analysis.js,
//   simulation.js, story.js, timeline.js, query.js, views.js,
//   exports.js
// ============================================================

// --- Dev mode configuration ---
async function _applyDevMode() {
    try {
        const res = await fetch('/api/config');
        if (res.ok) {
            const data = await res.json();
            _devMode = !!data.dev_mode;
        }
    } catch (e) { /* Default to production */ }
    if (!_devMode) {
        document.querySelectorAll('.dev-only').forEach(el => el.style.display = 'none');
        if (typeof loadGraph === 'function') loadGraph();
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

let _colorMode = 'risk';  // 'risk' or 'directory'

function changeColorMode(mode) {
    _colorMode = mode;
    if (!cy || !currentGraphData) return;

    // Only swap colors — sizes stay the same so the graph doesn't jump
    cy.batch(() => {
        cy.nodes().forEach(n => {
            if (mode === 'risk') {
                const riskColor = n.data('risk_color') || RISK_PALETTE[n.data('risk')] || RISK_PALETTE.normal;
                n.data('color', riskColor);
            } else {
                n.data('color', n.data('dir_color') || n.data('color'));
            }
        });
    });

    // Update the legend
    buildColorKey(currentGraphData.nodes);
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

    // Enrich node data: store original language color, apply risk if active
    const enrichedNodes = data.nodes.map(n => {
        const d = { ...n.data, label: n.data.id };
        // dir_color comes from the server; fall back to the original assigned color
        if (!d.dir_color) d.dir_color = d.color;
        if (_colorMode === 'risk') {
            d.color = d.risk_color || RISK_PALETTE[d.risk] || RISK_PALETTE.normal;
        }
        return { group: 'nodes', data: d };
    });

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

    // Track per-item checkbox state across re-renders
    const _refChecked = {};
    sorted.forEach(item => { _refChecked[item.id] = true; });

    // Risk → CSS class mapping for file list
    const _riskCssMap = { critical: 'god', high: 'god', warning: 'orphan', entry: 'orphan' };

    function _buildRefRow(item) {
        const riskCls = _riskCssMap[item.risk] || '';
        const div = document.createElement('div');
        div.className = 'list-row ref-dir-file-row';
        const left = document.createElement('div');
        left.className = 'list-row-left';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = _refChecked[item.id] !== false; cb.title = 'Toggle visibility';
        left.appendChild(cb);
        // Risk dot
        const riskDot = document.createElement('span');
        riskDot.style.cssText = 'display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px;flex-shrink:0;background:' + (RISK_PALETTE[item.risk] || RISK_PALETTE.normal);
        riskDot.title = item.risk;
        left.appendChild(riskDot);
        const name = document.createElement('span');
        name.className = 'file-name' + (riskCls ? ' ' + riskCls : '');
        // Show only the file name (directory is in the group header)
        const baseName = item.id.includes('/') ? item.id.split('/').pop() : item.id;
        name.textContent = baseName;
        name.title = item.id;
        left.appendChild(name);
        const pill = document.createElement('span');
        pill.className = 'count-pill';
        pill.textContent = item.count;
        div.appendChild(left);
        div.appendChild(pill);
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
    const dirOrder = Object.keys(dirGroups).sort((a, b) => {
        const sumA = dirGroups[a].reduce((s, i) => s + i.count, 0);
        const sumB = dirGroups[b].reduce((s, i) => s + i.count, 0);
        return sumB - sumA || a.localeCompare(b);
    });

    // Persist collapsed state across graph reloads
    if (!window._refDirCollapsed) window._refDirCollapsed = {};

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

    dirOrder.forEach(function(dir) {
        const items = dirGroups[dir];
        const totalRefs = items.reduce(function(s, i) { return s + i.count; }, 0);
        const isCollapsed = window._refDirCollapsed[dir] === true;

        // Directory group header
        const header = document.createElement('div');
        header.className = 'ref-dir-header' + (isCollapsed ? ' collapsed' : '');
        header.dataset.dir = dir;

        const headerLeft = document.createElement('div');
        headerLeft.className = 'ref-dir-header-left';
        headerLeft.innerHTML = '<svg class="ref-dir-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
            + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;flex-shrink:0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
            + '<span class="ref-dir-name">' + dir + '</span>';
        header.appendChild(headerLeft);

        const headerRight = document.createElement('div');
        headerRight.className = 'ref-dir-header-right';
        headerRight.innerHTML = '<span class="ref-dir-file-count">' + items.length + ' file' + (items.length !== 1 ? 's' : '') + '</span>'
            + '<span class="count-pill">' + totalRefs + '</span>';
        header.appendChild(headerRight);

        header.onclick = function() {
            var dirKey = this.dataset.dir;
            var body = this.nextElementSibling;
            var nowCollapsed = !this.classList.contains('collapsed');
            this.classList.toggle('collapsed', nowCollapsed);
            window._refDirCollapsed[dirKey] = nowCollapsed;
            if (body && body.classList.contains('ref-dir-body')) body.style.display = nowCollapsed ? 'none' : '';
        };

        refList.appendChild(header);

        // Directory group body (file rows)
        var body = document.createElement('div');
        body.className = 'ref-dir-body';
        body.style.display = isCollapsed ? 'none' : '';
        items.forEach(function(item) { body.appendChild(_buildRefRow(item)); });
        refList.appendChild(body);
    });

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

    // Run post-render hooks (registered by other modules)
    _postRenderHooks.forEach(fn => { try { fn(data); } catch(e) { console.warn('Post-render hook error:', e); } });
}

// ============================================================
// UPLOAD & GRAPH LOADING (with timeout support)
// ============================================================

function handleZipSelect(e) { const f = e.target.files[0]; if (!f) return; currentUploadedFile = f; uploadZip(); e.target.value = ''; }

function updateGraph() { if (currentMode === 'upload' && currentUploadedFile) uploadZip(); else loadGraph(); }

function uploadZip() {
    if (!currentUploadedFile) return;
    currentMode = 'upload';
    const fd = new FormData(); fd.append('file', currentUploadedFile);
    for (const [k, v] of Object.entries(getFilterValues())) fd.append(k, v);
    document.getElementById('loading').classList.add('active');
    _fetchWithTimeout('/api/upload', { method: 'POST', headers: _csrfHeaders(), body: fd }, _UPLOAD_TIMEOUT_MS)
        .then(r => r.json()).then(d => {
            if (d.error) { showToast('Error: ' + (d.suggestion || d.error), 5000); document.getElementById('loading').classList.remove('active'); }
            else { currentUploadToken = d.upload_token || null; renderGraph(d); showDetectedLanguages(d.detected); showDepthWarnings(d); }
        }).catch(err => { _handleApiError(err, 'Upload failed.'); document.getElementById('loading').classList.remove('active'); });
}

let _selectedLang = 'auto';

function selectLang(btn) {
    _selectedLang = btn.dataset.lang;
    document.querySelectorAll('.lang-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('langLabel').textContent = btn.textContent;
    document.getElementById('langDropdown').removeAttribute('open');
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
    document.getElementById('loading').classList.add('active');
    _fetchWithTimeout('/api/graph?' + new URLSearchParams({ dir: document.getElementById('dirInput').value, ...getFilterValues() }))
        .then(r => r.json()).then(d => {
            if (d.error) {
                showToast('Error: ' + (d.suggestion || d.error), 4000);
                document.getElementById('loading').classList.remove('active');
            } else {
                renderGraph(d);
                showDetectedLanguages(d.detected);
                showDepthWarnings(d);
            }
        }).catch(err => { _handleApiError(err, 'Failed to load graph.'); document.getElementById('loading').classList.remove('active'); });
}

// ============================================================
// INIT
// ============================================================
window.addEventListener('DOMContentLoaded', () => _applyDevMode());
