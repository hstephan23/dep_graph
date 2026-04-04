// ============================================================
// STATE — Shared globals & utility functions used by all modules
// ============================================================

/* global cytoscape */

// --- Dev mode ---
let _devMode = false;
let _currentView = 'graph';

// --- CSRF ---
let _csrfToken = '';
async function _fetchCsrfToken(retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch('/api/csrf-token');
            if (res.ok) { const data = await res.json(); _csrfToken = data.token || ''; return; }
        } catch (e) { /* server may still be booting */ }
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
    }
    console.warn('Could not fetch CSRF token after retries');
}
_fetchCsrfToken();
function _csrfHeaders() { return { 'X-CSRF-Token': _csrfToken }; }

// --- Core graph state ---
let cy, currentGraphData = null, pathHighlightActive = false;
let currentLayout = 'cose';
let currentMode = 'local', currentUploadedFile = null, currentUploadToken = null;

// Post-render hooks: modules can push callbacks here to run after renderGraph()
const _postRenderHooks = [];

// --- Compound node state ---
const COMPOUND_THRESHOLD = 100;
let _compound = {
    active: false,
    raw: null,
    collapsed: new Set(),
    dirMap: new Map(),
    allDirs: [],
};
const _COMPOUND_PALETTE = [
    '#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6',
    '#3b82f6','#ec4899','#14b8a6','#f97316','#06b6d4',
    '#84cc16','#a855f7','#0ea5e9','#eab308','#22d3ee',
    '#e879f9','#4ade80','#fb923c','#818cf8','#2dd4bf',
];

// Running layout tracker (prevents race conditions)
let _runningLayout = null;

// --- Utilities ---
function _escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

function showToast(msg, ms = 3000) {
    const t = document.createElement('div');
    t.className = 'toast';
    const isError = msg.toLowerCase().startsWith('error') || msg.toLowerCase().includes('failed');
    const icon = isError
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    t.innerHTML = icon + '<span>' + _escapeHtml(msg) + '</span>';
    t.style.display = 'flex';
    t.style.alignItems = 'center';
    t.style.gap = '0.5rem';
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('visible'));
    setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 300); }, ms);
}

const tooltip = document.createElement('div');
tooltip.className = 'custom-tooltip';
document.body.appendChild(tooltip);

function attachTooltip(el, text) {
    el.addEventListener('mouseenter', () => {
        tooltip.textContent = text;
        const r = el.getBoundingClientRect();
        tooltip.style.left = r.left + r.width / 2 + 'px';
        tooltip.style.top = r.top - 8 + 'px';
        tooltip.style.transform = 'translate(-50%, -100%)';
        tooltip.classList.add('visible');
    });
    el.addEventListener('mouseleave', () => tooltip.classList.remove('visible'));
}
