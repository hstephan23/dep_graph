/**
 * UI Management Module
 *
 * Extracted from app.js - contains all UI-related functions for theme,
 * sidebar, file preview, quick jump, keyboard shortcuts, and minimap management.
 * All globals from state.js are available.
 */

// --- Theme ---
const ICON_MOON = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
const ICON_SUN = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';

document.documentElement.setAttribute('data-theme', localStorage.getItem('theme') || 'light');

function applyThemeIcon(t) { document.getElementById('themeIcon').innerHTML = t === 'dark' ? ICON_SUN : ICON_MOON; }

function toggleTheme() {
    const n = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', n);
    localStorage.setItem('theme', n);
    applyThemeIcon(n);
    // Refresh compound styles for theme-aware colors
    if (_compound && _compound.active && typeof cy !== 'undefined' && cy) {
        cy.style(_compoundStyles());
    }
}

window.addEventListener('DOMContentLoaded', () => applyThemeIcon(document.documentElement.getAttribute('data-theme')));

// --- Collapsible Panel Sections ---
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.panel-header').forEach(header => {
        header.addEventListener('click', () => {
            header.classList.toggle('collapsed');
            // Find next sibling elements until the next panel-header
            let el = header.nextElementSibling;
            while (el && !el.classList.contains('panel-header')) {
                el.style.display = header.classList.contains('collapsed') ? 'none' : '';
                el = el.nextElementSibling;
            }
        });
    });
});

// --- Sidebar Toggle (responsive + desktop) ---
let _sidebarHidden = false;

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (window.innerWidth <= 900) {
        // Mobile: slide-in overlay
        sidebar.classList.toggle('open');
        backdrop.classList.toggle('open');
    } else {
        // Desktop: toggle via inline styles (avoids CSS caching issues)
        _sidebarHidden = !_sidebarHidden;
        if (_sidebarHidden) {
            sidebar.setAttribute('style', 'display:none !important');
        } else {
            sidebar.removeAttribute('style');
            // Force Cytoscape to resize into the reclaimed space
            if (typeof cy !== 'undefined' && cy) {
                setTimeout(() => cy.resize(), 50);
            }
        }
    }
}

// --- Sidebar tab switching ---
function switchTab(tab) {
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.panel).classList.add('active');
}

// --- File Preview Drawer ---
let previewOpen = false;
let previewDrawerHeight = 280;

function _getFileParams(fileId) {
    if (currentMode === 'upload' && currentUploadToken) {
        return { upload_token: currentUploadToken, path: fileId };
    }
    return { dir: document.getElementById('dirInput').value, path: fileId };
}

function getBaseDir() {
    if (currentMode === 'local') return document.getElementById('dirInput').value;
    if (currentMode === 'upload' && currentUploadToken) return currentUploadToken;
    return '';
}

function openPreview(fileId) {
    const dir = getBaseDir();
    if (!dir) { showToast('File preview only available for local directories'); return; }

    const drawer = document.getElementById('previewDrawer');
    const handle = document.getElementById('previewResizeHandle');

    document.getElementById('previewFileName').textContent = fileId;
    document.getElementById('previewMeta').textContent = 'Loading...';
    document.getElementById('previewCode').textContent = '';
    document.getElementById('previewCode').className = '';

    drawer.style.height = previewDrawerHeight + 'px';
    handle.style.bottom = previewDrawerHeight + 'px';
    drawer.classList.add('open');
    handle.classList.add('open');
    previewOpen = true;

    fetch('/api/file?' + new URLSearchParams(_getFileParams(fileId)))
        .then(r => r.json())
        .then(data => {
            if (data.error) {
                document.getElementById('previewMeta').textContent = '';
                document.getElementById('previewCode').textContent = data.error;
                return;
            }
            document.getElementById('previewMeta').textContent = `${data.lines} lines · ${data.language}`;
            const codeEl = document.getElementById('previewCode');
            codeEl.className = 'language-' + data.language;
            codeEl.textContent = data.content;
            Prism.highlightElement(codeEl);
        })
        .catch(() => {
            document.getElementById('previewMeta').textContent = '';
            document.getElementById('previewCode').textContent = 'Failed to load file.';
        });
}

function closePreview() {
    document.getElementById('previewDrawer').classList.remove('open');
    document.getElementById('previewResizeHandle').classList.remove('open');
    previewOpen = false;
}

// Resize handle drag
(function initPreviewResize() {
    const handle = document.getElementById('previewResizeHandle');
    if (!handle) return;
    let dragging = false, startY = 0, startH = 0;

    handle.addEventListener('mousedown', e => {
        dragging = true;
        startY = e.clientY;
        startH = previewDrawerHeight;
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        const delta = startY - e.clientY;
        previewDrawerHeight = Math.max(120, Math.min(window.innerHeight * 0.7, startH + delta));
        document.getElementById('previewDrawer').style.height = previewDrawerHeight + 'px';
        handle.style.bottom = previewDrawerHeight + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
})();

// ============================================================
// MINIMAP
// ============================================================

let minimapVisible = true;
let minimapRAF = null;

function toggleMinimap() {
    const el = document.getElementById('minimap');
    minimapVisible = !minimapVisible;
    if (minimapVisible) {
        el.classList.add('open');
        renderMinimap();
    } else {
        el.classList.remove('open');
        if (minimapRAF) { cancelAnimationFrame(minimapRAF); minimapRAF = null; }
    }
}

function renderMinimap() {
    if (!cy || !minimapVisible || !cy.container()) return;

    const canvas = document.getElementById('minimapCanvas');
    const body = canvas.parentElement;
    const ctx = canvas.getContext('2d');

    // Size canvas to container (retina-aware)
    const dpr = window.devicePixelRatio || 1;
    const cw = body.clientWidth;
    const ch = body.clientHeight;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    ctx.scale(dpr, dpr);

    // Get full graph bounding box
    const bb = cy.elements().boundingBox();
    if (!bb || bb.w === 0 || bb.h === 0) return;

    // Add padding around graph bounds
    const pad = 40;
    const gx = bb.x1 - pad;
    const gy = bb.y1 - pad;
    const gw = bb.w + pad * 2;
    const gh = bb.h + pad * 2;

    // Compute scale to fit graph into canvas
    const scale = Math.min(cw / gw, ch / gh);
    const ox = (cw - gw * scale) / 2;
    const oy = (ch - gh * scale) / 2;

    // Clear
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    ctx.fillStyle = isDark ? '#12131f' : '#e2e8f0';
    ctx.fillRect(0, 0, cw, ch);

    // Draw edges
    ctx.lineWidth = Math.max(0.5, 1 * scale);
    cy.edges().forEach(e => {
        if (e.style('display') === 'none') return;
        const sp = e.source().position();
        const tp = e.target().position();
        const sx = ox + (sp.x - gx) * scale;
        const sy = oy + (sp.y - gy) * scale;
        const tx = ox + (tp.x - gx) * scale;
        const ty = oy + (tp.y - gy) * scale;

        const color = e.style('line-color');
        ctx.strokeStyle = color || (isDark ? 'rgba(139,143,255,0.15)' : 'rgba(148,163,184,0.35)');
        ctx.globalAlpha = parseFloat(e.style('opacity')) || 0.4;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // Draw nodes
    cy.nodes().forEach(n => {
        if (n.style('display') === 'none') return;
        const pos = n.position();
        const nx = ox + (pos.x - gx) * scale;
        const ny = oy + (pos.y - gy) * scale;
        const size = Math.max(2, ((n.data('size') || 80) / 2) * scale);

        ctx.fillStyle = n.data('color') || (isDark ? '#818cf8' : '#6366f1');
        ctx.globalAlpha = parseFloat(n.style('opacity')) || 1;
        ctx.beginPath();
        ctx.arc(nx, ny, size, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Update viewport rectangle
    updateMinimapViewport(gx, gy, gw, gh, scale, ox, oy, cw, ch);
}

function updateMinimapViewport(gx, gy, gw, gh, scale, ox, oy, cw, ch) {
    if (!cy) return;
    const vp = document.getElementById('minimapViewport');
    const ext = cy.extent(); // visible area in model coords

    // Map extent to canvas coords
    let vl = ox + (ext.x1 - gx) * scale;
    let vt = oy + (ext.y1 - gy) * scale;
    let vw = ext.w * scale;
    let vh = ext.h * scale;

    // Clamp to canvas
    vl = Math.max(0, vl);
    vt = Math.max(0, vt);
    vw = Math.min(cw - vl, vw);
    vh = Math.min(ch - vt, vh);

    vp.style.left = vl + 'px';
    vp.style.top = vt + 'px';
    vp.style.width = vw + 'px';
    vp.style.height = vh + 'px';

    // Store transform for click-to-pan
    vp.dataset.gx = gx;
    vp.dataset.gy = gy;
    vp.dataset.scale = scale;
    vp.dataset.ox = ox;
    vp.dataset.oy = oy;
}

// Sync minimap on pan/zoom
function scheduleMinimapUpdate() {
    if (!minimapVisible) return;
    if (minimapRAF) cancelAnimationFrame(minimapRAF);
    minimapRAF = requestAnimationFrame(renderMinimap);
}

// Click-to-pan on minimap body
(function initMinimapInteraction() {
    document.addEventListener('DOMContentLoaded', () => {
        const body = document.querySelector('.minimap-body');
        if (!body) return;

        let dragging = false;

        function panToMinimapPos(clientX, clientY) {
            if (!cy) return;
            const vp = document.getElementById('minimapViewport');
            const rect = body.getBoundingClientRect();
            const mx = clientX - rect.left;
            const my = clientY - rect.top;

            const gx = parseFloat(vp.dataset.gx);
            const gy = parseFloat(vp.dataset.gy);
            const sc = parseFloat(vp.dataset.scale);
            const ox = parseFloat(vp.dataset.ox);
            const oy = parseFloat(vp.dataset.oy);

            if (isNaN(sc) || sc === 0) return;

            // Convert minimap pixel to graph model coordinate
            const modelX = (mx - ox) / sc + gx;
            const modelY = (my - oy) / sc + gy;

            // Pan so the clicked model point is centered in the viewport
            const cyContainer = cy.container();
            const zoom = cy.zoom();
            cy.pan({
                x: cyContainer.clientWidth / 2 - modelX * zoom,
                y: cyContainer.clientHeight / 2 - modelY * zoom
            });
        }

        body.addEventListener('mousedown', e => {
            dragging = true;
            panToMinimapPos(e.clientX, e.clientY);
            e.preventDefault();
        });

        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            panToMinimapPos(e.clientX, e.clientY);
        });

        document.addEventListener('mouseup', () => { dragging = false; });
    });
})();

// Hook into Cytoscape events after graph render
function attachMinimapListeners() {
    if (!cy) return;
    // Use namespace to prevent stacking
    cy.off('pan.minimap zoom.minimap resize.minimap layoutstop.minimap');
    cy.on('pan.minimap zoom.minimap resize.minimap', scheduleMinimapUpdate);
    cy.on('layoutstop.minimap', () => { setTimeout(renderMinimap, 100); });
    if (minimapVisible) renderMinimap();
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================

// --- Quick Jump (Cmd+K) ---
let quickjumpActiveIndex = -1;

function openQuickJump() {
    const modal = document.getElementById('quickjumpModal');
    if (!modal) return;
    const input = document.getElementById('quickjumpInput');
    const results = document.getElementById('quickjumpResults');
    const empty = document.getElementById('quickjumpEmpty');
    const hint = document.getElementById('quickjumpHint');
    input.value = '';
    results.innerHTML = '';
    empty.style.display = 'none';
    hint.style.display = '';
    quickjumpActiveIndex = -1;
    modal.classList.add('open');
    requestAnimationFrame(() => input.focus());
}

function closeQuickJump() {
    const modal = document.getElementById('quickjumpModal');
    if (modal) modal.classList.remove('open');
}

function isQuickJumpOpen() {
    const modal = document.getElementById('quickjumpModal');
    return modal && modal.classList.contains('open');
}

function quickjumpHighlightMatch(text, query) {
    if (!query) return _escapeHtml(text);
    const lower = text.toLowerCase();
    const qLower = query.toLowerCase();
    const idx = lower.indexOf(qLower);
    if (idx === -1) return _escapeHtml(text);
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + query.length);
    const after = text.slice(idx + query.length);
    return _escapeHtml(before) + '<mark>' + _escapeHtml(match) + '</mark>' + _escapeHtml(after);
}

function quickjumpSetActive(index) {
    const items = document.querySelectorAll('.quickjump-result-item');
    items.forEach(el => el.classList.remove('active'));
    quickjumpActiveIndex = index;
    if (items[index]) {
        items[index].classList.add('active');
        items[index].scrollIntoView({ block: 'nearest' });
    }
}

function quickjumpNavigate(nodeId) {
    closeQuickJump();
    if (!cy) return;
    const node = cy.getElementById(nodeId);
    if (!node || !node.length) { showToast('Node not found in graph'); return; }

    // Clear existing highlights
    clearPathHighlight();

    // Animate to node
    cy.animate({ center: { eles: node }, zoom: 1.5 }, { duration: 400, complete: () => {
        // Highlight paths from node after arriving
        highlightPaths(nodeId);
        showBlastRadius(nodeId);
    }});

    showToast('Jumped to ' + nodeId.split('/').pop());
}

function quickjumpSearch(query) {
    const results = document.getElementById('quickjumpResults');
    const empty = document.getElementById('quickjumpEmpty');
    const hint = document.getElementById('quickjumpHint');
    results.innerHTML = '';
    quickjumpActiveIndex = -1;

    if (!query) {
        empty.style.display = 'none';
        hint.style.display = '';
        return;
    }

    hint.style.display = 'none';

    if (!cy) {
        empty.style.display = '';
        empty.textContent = 'No graph loaded';
        return;
    }

    const q = query.toLowerCase();
    const nodes = cy.nodes();
    const matches = [];

    nodes.forEach(n => {
        const id = n.id();
        const lower = id.toLowerCase();
        if (!lower.includes(q)) return;
        // Score: prefer exact filename match, then start-of-segment match, then substring
        const filename = id.split('/').pop().toLowerCase();
        let score = 0;
        if (filename === q) score = 3;
        else if (filename.startsWith(q)) score = 2;
        else if (lower.startsWith(q)) score = 1;
        matches.push({ id, color: n.data('color'), inDegree: n.indegree(), score });
    });

    // Sort: highest score first, then by in-degree (most referenced first)
    matches.sort((a, b) => b.score - a.score || b.inDegree - a.inDegree);

    // Limit to 15 results for performance
    const capped = matches.slice(0, 15);

    if (!capped.length) {
        empty.style.display = '';
        empty.textContent = 'No matching files';
        return;
    }

    empty.style.display = 'none';

    capped.forEach((m, i) => {
        const item = document.createElement('div');
        item.className = 'quickjump-result-item';
        item.innerHTML =
            '<span class="quickjump-result-dot" style="background:' + m.color + '"></span>' +
            '<span class="quickjump-result-label">' + quickjumpHighlightMatch(m.id, query) + '</span>' +
            '<span class="quickjump-result-meta">' + m.inDegree + ' ref' + (m.inDegree !== 1 ? 's' : '') + '</span>';
        item.addEventListener('click', () => quickjumpNavigate(m.id));
        item.addEventListener('mouseenter', () => quickjumpSetActive(i));
        results.appendChild(item);
    });

    // Auto-select first result
    quickjumpSetActive(0);
}

// Attach events after DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('quickjumpInput');
    if (!input) return;

    input.addEventListener('input', () => quickjumpSearch(input.value.trim()));

    input.addEventListener('keydown', e => {
        const items = document.querySelectorAll('.quickjump-result-item');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            quickjumpSetActive(Math.min(quickjumpActiveIndex + 1, items.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            quickjumpSetActive(Math.max(quickjumpActiveIndex - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (items[quickjumpActiveIndex]) items[quickjumpActiveIndex].click();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeQuickJump();
        }
    });
});

const SHORTCUTS = [
    { section: 'General', items: [
        { keys: 'Cmd+K',       desc: 'Quick jump to file',             action: (e) => { e.preventDefault(); openQuickJump(); } },
        { keys: '?',           desc: 'Show / hide this help',          action: () => toggleShortcutHelp() },
        { keys: 'Escape',      desc: 'Close modal / clear selection',  action: () => {
            const modal = document.getElementById('shortcutModal');
            if (modal && modal.classList.contains('open')) { toggleShortcutHelp(); return; }
            const qt = document.getElementById('queryTerminal');
            if (qt && qt.classList.contains('open')) { if (_queryActive) clearQuery(); else toggleQueryTerminal(); return; }
            clearPathHighlight();
            if (previewOpen) closePreview();
        }},
        { keys: 't',           desc: 'Toggle light / dark theme',      action: () => toggleTheme() },
        { keys: 's',           desc: 'Toggle sidebar',                 action: () => toggleSidebar() },
    ]},
    { section: 'Graph', items: [
        { keys: 'q',           desc: 'Toggle query terminal',          action: () => toggleQueryTerminal() },
        { keys: 'g',           desc: 'Generate graph',                 action: () => loadGraph() },
        { keys: '/',           desc: 'Focus search',                   action: (e) => { e.preventDefault(); document.getElementById('searchInput').focus(); } },
        { keys: 'd',           desc: 'Focus directory input',          action: () => document.getElementById('dirInput').focus() },
        { keys: 'f',           desc: 'Fit graph to viewport',          action: () => { if (cy) cy.fit(undefined, 50); } },
        { keys: 'm',           desc: 'Toggle minimap',                  action: () => toggleMinimap() },
        { keys: 'z',           desc: 'Zoom to selected node',          action: () => { if (cy) { const sel = cy.nodes(':selected'); if (sel.length) cy.animate({ center: { eles: sel }, zoom: 2 }, { duration: 400 }); } } },
    ]},
    { section: 'Layout', items: [
        { keys: '1',           desc: 'Force layout',                   action: () => { changeLayout('cose'); document.getElementById('layoutCose').checked = true; showToast('Layout: Force'); } },
        { keys: '2',           desc: 'Hierarchy layout',               action: () => { changeLayout('dagre'); document.getElementById('layoutDagre').checked = true; showToast('Layout: Hierarchy'); } },
        { keys: '3',           desc: 'Concentric layout',              action: () => { changeLayout('concentric'); document.getElementById('layoutConcentric').checked = true; showToast('Layout: Concentric'); } },
        { keys: 'l',           desc: 'Toggle focus lens',              action: () => fisheyeToggle() },
    ]},
    { section: 'Panels', items: [
        { keys: 'Shift+1',     desc: 'Refs panel',                     action: () => activatePanel(0) },
        { keys: 'Shift+2',     desc: 'Analysis panel',                 action: () => activatePanel(1) },
        { keys: 'Shift+3',     desc: 'Unused panel',                   action: () => activatePanel(2) },
        { keys: 'Shift+4',     desc: 'Blast radius panel',             action: () => activatePanel(3) },
        { keys: 'Shift+5',     desc: 'Layers panel',                   action: () => activatePanel(4) },
        { keys: 'Shift+6',     desc: 'Rules panel',                    action: () => activatePanel(5) },
        { keys: 'Shift+7',     desc: 'Path finder panel',              action: () => activatePanel(6) },
        { keys: 'Shift+8',     desc: 'Diff panel',                     action: () => activatePanel(7) },
        { keys: 'Shift+9',     desc: 'Simulate panel',                 action: () => activatePanel(8) },
        { keys: 'Shift+0',     desc: 'Story mode panel',               action: () => activatePanel(9) },
    ]},
    { section: 'Export', items: [
        { keys: 'e j',         desc: 'Export JSON',                    action: () => exportJSON(),        combo: true },
        { keys: 'e p',         desc: 'Export PNG',                     action: () => exportPNG(),         combo: true },
        { keys: 'e d',         desc: 'Export DOT',                     action: () => exportDOT(),         combo: true },
        { keys: 'e m',         desc: 'Export Mermaid',                 action: () => exportMermaid(),     combo: true },
    ]},
];

function activatePanel(index) {
    const tabs = document.querySelectorAll('.sidebar-tab');
    if (tabs[index]) {
        switchTab(tabs[index]);
        // Ensure sidebar is visible on mobile
        const sidebar = document.getElementById('sidebar');
        if (!sidebar.classList.contains('open') && window.innerWidth <= 900) toggleSidebar();
    }
}

// --- Sequence key support (for "e j", "e p", etc.) ---
let pendingPrefix = null;
let pendingTimer = null;

function clearPendingPrefix() {
    pendingPrefix = null;
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
}

document.addEventListener('keydown', e => {
    // Cmd+K / Ctrl+K — Quick Jump (works even from inputs)
    if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (isQuickJumpOpen()) closeQuickJump();
        else openQuickJump();
        return;
    }

    // Ignore when typing in inputs/textareas/selects
    const tag = e.target.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;

    // Allow Escape even in input contexts
    if (e.key === 'Escape') {
        if (isQuickJumpOpen()) { closeQuickJump(); return; }
        if (isInput) { e.target.blur(); return; }
        for (const sec of SHORTCUTS) {
            for (const s of sec.items) {
                if (s.keys === 'Escape') { s.action(e); return; }
            }
        }
        return;
    }

    if (isInput) return;

    // Build the key string
    let keyStr = e.key;

    // Handle sequence combos (e.g. "e j")
    if (pendingPrefix) {
        const comboStr = pendingPrefix + ' ' + keyStr;
        clearPendingPrefix();
        for (const sec of SHORTCUTS) {
            for (const s of sec.items) {
                if (s.combo && s.keys === comboStr) { s.action(e); return; }
            }
        }
        return;
    }

    // Check if this key is a prefix for a combo
    const isPrefix = SHORTCUTS.some(sec => sec.items.some(s => s.combo && s.keys.startsWith(keyStr + ' ')));
    if (isPrefix) {
        pendingPrefix = keyStr;
        pendingTimer = setTimeout(clearPendingPrefix, 800);
        return;
    }

    // Handle Shift+number — map the symbol to Shift+N
    if (e.shiftKey) {
        const shiftMap = { '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0' };
        if (shiftMap[e.key]) keyStr = 'Shift+' + shiftMap[e.key];
    }

    // Direct match
    for (const sec of SHORTCUTS) {
        for (const s of sec.items) {
            if (!s.combo && s.keys === keyStr) { s.action(e); return; }
        }
    }
});

// --- Help modal toggle ---
function toggleShortcutHelp() {
    const modal = document.getElementById('shortcutModal');
    if (!modal) return;
    modal.classList.toggle('open');
}

// Build help modal content on load
window.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('shortcutModal');
    if (!modal) return;
    const grid = modal.querySelector('.shortcut-grid');
    if (!grid) return;

    SHORTCUTS.forEach(sec => {
        const section = document.createElement('div');
        section.className = 'shortcut-section';
        const heading = document.createElement('div');
        heading.className = 'shortcut-section-title';
        heading.textContent = sec.section;
        section.appendChild(heading);

        sec.items.forEach(s => {
            const row = document.createElement('div');
            row.className = 'shortcut-row';
            const keys = document.createElement('div');
            keys.className = 'shortcut-keys';
            // Split on + or space, but keep the separator type
            const parts = s.keys.split(/(\+| )/);
            const keyTokens = parts.filter(p => p !== '+' && p !== ' ' && p !== '');
            keyTokens.forEach((k, i) => {
                const kbd = document.createElement('kbd');
                const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
                kbd.textContent = k === 'Cmd' ? (isMac ? '\u2318' : 'Ctrl') : k;
                keys.appendChild(kbd);
                if (i < keyTokens.length - 1) {
                    const sep = document.createElement('span');
                    sep.className = 'shortcut-sep';
                    sep.textContent = s.combo ? 'then' : '+';
                    keys.appendChild(sep);
                }
            });
            const desc = document.createElement('span');
            desc.className = 'shortcut-desc';
            desc.textContent = s.desc;
            row.appendChild(keys);
            row.appendChild(desc);
            section.appendChild(row);
        });

        grid.appendChild(section);
    });
});
