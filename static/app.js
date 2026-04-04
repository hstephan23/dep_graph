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
    const elements = [
        ...data.nodes.map(n => ({ group: 'nodes', data: { ...n.data, label: n.data.id } })),
        ...data.edges,
    ];
    _cInitCy(elements, _normalStyles());
    _cBindNormalHandlers();
    // Escape handled by global shortcut system below

    // Attach minimap listeners
    attachMinimapListeners();

    // Show/hide the scope toggle and sync radio state
    pdUpdateToggle();
    const pdRadio = document.getElementById(_compound.active ? 'pdViewDirs' : 'pdViewFiles');
    if (pdRadio) pdRadio.checked = true;

    // Show graph status bar, path hint, and folder color key
    if (data.nodes && data.nodes.length) {
        document.getElementById('graphStatusBar').style.display = 'flex';
        document.getElementById('pathHint').style.display = 'block';
        if (!_compound.active) buildFolderColorKey(data.nodes);
        updatePathDatalist();
    }

    // --- Ref list (virtual-scrolled) ---
    const refList = document.getElementById('ref-list');
    refList.innerHTML = '';
    const inDeg = {};
    data.nodes.forEach(n => inDeg[n.data.id] = 0);
    data.edges.forEach(e => { if (inDeg[e.data.target] !== undefined) inDeg[e.data.target]++; });
    const sorted = data.nodes.map(n => ({ id: n.data.id, count: inDeg[n.data.id] })).sort((a, b) => b.count - a.count);
    const maxC = sorted.length ? sorted[0].count : 0;
    const godT = Math.max(10, maxC * 0.5);
    document.getElementById('nodeCountBadge').textContent = sorted.length;

    // Track per-item checkbox state so virtual re-renders preserve toggles
    const _refChecked = {};
    sorted.forEach(item => { _refChecked[item.id] = true; });

    const ROW_H = 33;       // approximate height of a .list-row in px
    const BUFFER = 10;      // extra rows rendered above/below viewport
    const VIRTUAL_THRESHOLD = 300; // only virtualise when list is large

    function _buildRefRow(item) {
        const isGod = item.count >= godT && item.count > 0;
        const isOrphan = item.count === 0;
        const div = document.createElement('div');
        div.className = 'list-row';
        const left = document.createElement('div');
        left.className = 'list-row-left';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = _refChecked[item.id] !== false; cb.title = 'Toggle visibility';
        left.appendChild(cb);
        const name = document.createElement('span');
        name.className = 'file-name' + (isGod ? ' god' : isOrphan ? ' orphan' : '');
        name.textContent = item.id;
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

    if (sorted.length <= VIRTUAL_THRESHOLD) {
        // Small list — render everything directly (no overhead)
        sorted.forEach(item => refList.appendChild(_buildRefRow(item)));
    } else {
        // Virtual scrolling for large lists
        refList.style.position = 'relative';
        refList.style.overflow = 'auto';
        if (!refList.style.maxHeight) refList.style.maxHeight = '60vh';

        const spacer = document.createElement('div');
        spacer.style.height = (sorted.length * ROW_H) + 'px';
        spacer.style.position = 'relative';
        refList.appendChild(spacer);

        const viewport = document.createElement('div');
        viewport.style.position = 'absolute';
        viewport.style.left = '0';
        viewport.style.right = '0';
        viewport.style.willChange = 'transform';
        spacer.appendChild(viewport);

        let _lastStart = -1, _lastEnd = -1;

        function _renderVisibleRefRows() {
            const scrollTop = refList.scrollTop;
            const viewH = refList.clientHeight;
            const start = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER);
            const end = Math.min(sorted.length, Math.ceil((scrollTop + viewH) / ROW_H) + BUFFER);
            if (start === _lastStart && end === _lastEnd) return;
            _lastStart = start;
            _lastEnd = end;
            viewport.style.transform = 'translateY(' + (start * ROW_H) + 'px)';
            viewport.innerHTML = '';
            for (let i = start; i < end; i++) {
                viewport.appendChild(_buildRefRow(sorted[i]));
            }
        }

        _renderVisibleRefRows();
        refList.addEventListener('scroll', _renderVisibleRefRows, { passive: true });
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
    const langs = [];
    if (det.has_c) langs.push('C'); if (det.has_h) langs.push('Headers'); if (det.has_cpp) langs.push('C++');
    if (det.has_js) langs.push('JS/TS'); if (det.has_py) langs.push('Python'); if (det.has_java) langs.push('Java');
    if (det.has_go) langs.push('Go'); if (det.has_rust) langs.push('Rust'); if (det.has_cs) langs.push('C#');
    if (det.has_swift) langs.push('Swift'); if (det.has_ruby) langs.push('Ruby');
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
