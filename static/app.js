// ============================================================
// APP — Main entry point
// Loads graph data, renders the graph, handles upload/directory.
// All other functionality lives in separate module files.
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

// --- Main Render ---
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

    // --- Ref list ---
    const refList = document.getElementById('ref-list');
    refList.innerHTML = '';
    const inDeg = {};
    data.nodes.forEach(n => inDeg[n.data.id] = 0);
    data.edges.forEach(e => { if (inDeg[e.data.target] !== undefined) inDeg[e.data.target]++; });
    const sorted = data.nodes.map(n => ({ id: n.data.id, count: inDeg[n.data.id] })).sort((a, b) => b.count - a.count);
    const maxC = sorted.length ? sorted[0].count : 0;
    const godT = Math.max(10, maxC * 0.5);
    document.getElementById('nodeCountBadge').textContent = sorted.length;

    sorted.forEach(item => {
        const isGod = item.count >= godT && item.count > 0;
        const isOrphan = item.count === 0;
        const div = document.createElement('div');
        div.className = 'list-row';
        const left = document.createElement('div');
        left.className = 'list-row-left';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = true; cb.title = 'Toggle visibility';
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
        cb.onchange = (e) => { const n = cy.getElementById(item.id); if (n.length) n.style('display', e.target.checked ? 'element' : 'none'); };
        name.onclick = () => { const n = cy.getElementById(item.id); if (n.length) cy.animate({ center: { eles: n }, zoom: 1.5 }, { duration: 400 }); };
        refList.appendChild(div);
    });

    // --- Unused ---
    const ul = document.getElementById('unused-list');
    ul.innerHTML = '';
    const unused = data.unused_files || [];
    document.getElementById('unusedCountBadge').textContent = unused.length;
    if (!unused.length) { ul.innerHTML = '<div class="metric-row"><span class="metric-label" style="color:var(--success);">All files are referenced</span></div>'; }
    else unused.forEach(fid => {
        const d = document.createElement('div');
        d.className = 'metric-row clickable';
        d.innerHTML = `<span class="metric-label">${fid}</span><span class="badge badge-red">0 refs</span>`;
        d.onclick = () => { const n = cy.getElementById(fid); if (n.length) cy.animate({ center: { eles: n }, zoom: 1.5 }, { duration: 400 }); };
        ul.appendChild(d);
    });

    // --- Coupling ---
    const cl = document.getElementById('coupling-list');
    cl.innerHTML = '';
    const coupling = data.coupling || [];
    if (!coupling.length) cl.innerHTML = '<div class="metric-row"><span class="metric-label">No cross-directory edges</span></div>';
    else coupling.forEach(c => {
        const d = document.createElement('div');
        d.className = 'metric-row';
        d.innerHTML = `<span class="metric-label">${c.dir1} ↔ ${c.dir2}</span><span class="badge ${c.score > 0.3 ? 'badge-red' : c.score > 0.1 ? 'badge-yellow' : 'badge-green'}">${c.cross_edges} (${c.score})</span>`;
        cl.appendChild(d);
    });

    // Run post-render hooks (registered by other modules)
    _postRenderHooks.forEach(fn => { try { fn(data); } catch(e) { console.warn('Post-render hook error:', e); } });
}

// --- Upload & Loading ---
function handleZipSelect(e) { const f = e.target.files[0]; if (!f) return; currentUploadedFile = f; uploadZip(); e.target.value = ''; }

function updateGraph() { if (currentMode === 'upload' && currentUploadedFile) uploadZip(); else loadGraph(); }

function uploadZip() {
    if (!currentUploadedFile) return;
    currentMode = 'upload';
    const fd = new FormData(); fd.append('file', currentUploadedFile);
    for (const [k, v] of Object.entries(getFilterValues())) fd.append(k, v);
    document.getElementById('loading').classList.add('active');
    fetch('/api/upload', { method: 'POST', headers: _csrfHeaders(), body: fd })
        .then(r => r.json()).then(d => {
            if (d.error) { showToast('Error: ' + d.error, 5000); document.getElementById('loading').classList.remove('active'); }
            else { currentUploadToken = d.upload_token || null; renderGraph(d); showDetectedLanguages(d.detected); showDepthWarnings(d); }
        }).catch(err => { console.error('uploadZip error:', err); showToast('Upload failed.', 5000); document.getElementById('loading').classList.remove('active'); });
}

function getFilterValues() {
    const m = document.querySelector('input[name="langMode"]:checked').value;
    const common = { hide_system: document.getElementById('hideSystemHeaders').checked, hide_isolated: document.getElementById('hideIsolated').checked, filter_dir: document.getElementById('filterDirInput').value };
    if (m === 'auto') return { mode: 'auto', ...common };
    return { ...common, show_c: m === 'c' || m === 'cpp', show_h: m === 'c' || m === 'cpp', show_cpp: m === 'cpp', show_js: m === 'js', show_py: m === 'py', show_java: m === 'java', show_go: m === 'go', show_rust: m === 'rust', show_cs: m === 'cs', show_swift: m === 'swift', show_ruby: m === 'ruby' };
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
    fetch('/api/graph?' + new URLSearchParams({ dir: document.getElementById('dirInput').value, ...getFilterValues() }))
        .then(r => r.json()).then(d => {
            if (d.error) {
                showToast('Error: ' + d.error, 4000);
                document.getElementById('loading').classList.remove('active');
            } else {
                renderGraph(d);
                showDetectedLanguages(d.detected);
                showDepthWarnings(d);
            }
        }).catch(err => { console.error('loadGraph error:', err); document.getElementById('loading').classList.remove('active'); });
}

// --- Init ---
window.addEventListener('DOMContentLoaded', () => _applyDevMode());
