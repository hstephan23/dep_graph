// ================================================================
// EXPORTS MODULE
// ================================================================
// This module contains export functions and insights generation logic
// extracted from app.js. All globals from state.js are available.
//
// Contents:
// - Export functions: exportJSON, exportPNG, exportDOT, exportMermaid
// - Insights functions: _insightsData, openInsights, closeInsights,
//   computeInsights, renderInsightsModal, exportInsights, buildInsightsMarkdown

// --- Exports ---
function exportJSON() {
    if (!currentGraphData) return;
    const a = document.createElement('a');
    a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentGraphData, null, 2));
    a.download = "dependency_graph.json"; document.body.appendChild(a); a.click(); a.remove();
}

function exportPNG() {
    if (!cy) return;
    const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    const graphDataUrl = cy.png({ output: 'base64uri', bg: bgColor, full: true });

    // Draw the graph onto a canvas and add a logo watermark in the bottom-right
    const img = new Image();
    img.onload = function () {
        const pad = 32;
        const logoSize = 64;
        const textHeight = 28;
        const watermarkH = logoSize + pad * 2;
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height + watermarkH;
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Graph
        ctx.drawImage(img, 0, 0);

        // Watermark bar
        const logo = new Image();
        logo.onload = function () {
            const y = img.height + pad;
            ctx.globalAlpha = 0.7;
            ctx.drawImage(logo, canvas.width - logoSize - pad, y, logoSize, logoSize);
            ctx.globalAlpha = 0.6;
            ctx.font = '700 ' + textHeight + 'px Inter, system-ui, sans-serif';
            ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#333';
            ctx.textAlign = 'right';
            ctx.fillText('DepGraph', canvas.width - logoSize - pad - 8, y + logoSize / 2 + textHeight / 3);
            ctx.globalAlpha = 1;

            const a = document.createElement('a');
            a.href = canvas.toDataURL('image/png');
            a.download = 'dependency_graph.png';
            document.body.appendChild(a); a.click(); a.remove();
        };
        logo.onerror = function () {
            // If logo fails to load, export without it
            const a = document.createElement('a');
            a.href = canvas.toDataURL('image/png');
            a.download = 'dependency_graph.png';
            document.body.appendChild(a); a.click(); a.remove();
        };
        logo.src = '/static/logo.png';
    };
    img.src = graphDataUrl;
}

function exportDOT() {
    if (!currentGraphData) return;
    let s = 'digraph DependencyGraph {\n  node [shape=box, style=filled, fontname="Inter"];\n  rankdir=LR;\n';
    (currentGraphData.nodes || []).forEach(n => { s += `  "${n.data.id}" [fillcolor="${n.data.color || '#ccc'}"];\n`; });
    (currentGraphData.edges || []).forEach(e => {
        const cyc = e.classes && e.classes.includes('cycle');
        s += `  "${e.data.source}" -> "${e.data.target}" [${cyc ? 'color="red", penwidth=2' : `color="${e.data.color || '#94a3b8'}"`}];\n`;
    });
    s += '}\n';
    const a = document.createElement('a');
    a.href = "data:text/vnd.graphviz;charset=utf-8," + encodeURIComponent(s);
    a.download = "dependency_graph.dot"; document.body.appendChild(a); a.click(); a.remove();
}

function exportMermaid() {
    if (!currentGraphData) return;

    // Sanitize node IDs for Mermaid — replace non-alphanumeric chars with underscores
    // but keep the original name for display labels
    const idMap = {};
    let counter = 0;
    function mermaidId(name) {
        if (idMap[name]) return idMap[name];
        const id = 'n' + (counter++);
        idMap[name] = id;
        return id;
    }

    // Group nodes by directory for subgraph support
    const dirMap = {};
    (currentGraphData.nodes || []).forEach(n => {
        const id = n.data.id;
        const dir = id.includes('/') ? id.substring(0, id.lastIndexOf('/')) : '.';
        if (!dirMap[dir]) dirMap[dir] = [];
        dirMap[dir].push(id);
    });

    // Detect cycle edges for styling
    const cycleEdges = new Set();
    (currentGraphData.edges || []).forEach(e => {
        if (e.classes && e.classes.includes('cycle')) {
            cycleEdges.add(e.data.source + '|' + e.data.target);
        }
    });

    let s = 'graph TD\n';

    // Emit subgraphs for directories with more than one file
    const dirs = Object.keys(dirMap).sort();
    const emittedInSubgraph = new Set();

    dirs.forEach(dir => {
        const files = dirMap[dir];
        if (files.length > 1 && dir !== '.') {
            const subId = dir.replace(/[^a-zA-Z0-9]/g, '_');
            s += `\n  subgraph ${subId}["${dir}"]\n`;
            files.forEach(f => {
                const label = f.includes('/') ? f.substring(f.lastIndexOf('/') + 1) : f;
                s += `    ${mermaidId(f)}["${label}"]\n`;
                emittedInSubgraph.add(f);
            });
            s += '  end\n';
        }
    });

    // Emit remaining nodes not in a subgraph
    (currentGraphData.nodes || []).forEach(n => {
        if (!emittedInSubgraph.has(n.data.id)) {
            s += `  ${mermaidId(n.data.id)}["${n.data.id}"]\n`;
        }
    });

    s += '\n';

    // Emit edges
    (currentGraphData.edges || []).forEach(e => {
        const src = mermaidId(e.data.source);
        const tgt = mermaidId(e.data.target);
        const isCycle = cycleEdges.has(e.data.source + '|' + e.data.target);
        if (isCycle) {
            s += `  ${src} -. cycle .-> ${tgt}\n`;
        } else {
            s += `  ${src} --> ${tgt}\n`;
        }
    });

    // Add cycle edge styling
    if (cycleEdges.size > 0) {
        s += '\n  linkStyle default stroke:#94a3b8\n';
    }

    const a = document.createElement('a');
    a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(s);
    a.download = "dependency_graph.mmd";
    document.body.appendChild(a); a.click(); a.remove();
    showToast('Exported Mermaid diagram (.mmd)');
}

// ================================================================
// INSIGHTS MODAL
// ================================================================
let _insightsData = null;

function openInsights() {
    if (!currentGraphData || !currentGraphData.nodes.length) {
        showToast('Load a graph first to see insights');
        return;
    }
    _insightsData = computeInsights();
    renderInsightsModal(_insightsData);
    document.getElementById('insightsModal').classList.add('open');
}

function closeInsights() {
    document.getElementById('insightsModal').classList.remove('open');
}

function computeInsights() {
    var data = currentGraphData;
    var nodes = data.nodes;
    var edges = data.edges;
    var n = nodes.length;

    // ---- Degree maps ----
    var inDeg = {}, outDeg = {};
    nodes.forEach(function(nd) { inDeg[nd.data.id] = 0; outDeg[nd.data.id] = 0; });
    edges.forEach(function(e) {
        if (inDeg[e.data.target] !== undefined) inDeg[e.data.target]++;
        if (outDeg[e.data.source] !== undefined) outDeg[e.data.source]++;
    });

    // ---- Overview ----
    var maxPossible = n * (n - 1);
    var density = maxPossible > 0 ? +(edges.length / maxPossible * 100).toFixed(1) : 0;

    var dirSet = new Set();
    nodes.forEach(function(nd) {
        var id = nd.data.id;
        dirSet.add(id.includes('/') ? id.substring(0, id.lastIndexOf('/')) : '.');
    });

    var overview = {
        files: n,
        edges: edges.length,
        directories: dirSet.size,
        density: density
    };

    // ---- Cycles ----
    var cycles = data.cycles || [];
    var filesInCycles = new Set();
    cycles.forEach(function(c) { c.forEach(function(f) { filesInCycles.add(f); }); });

    // ---- God files ----
    var maxC = 0;
    nodes.forEach(function(nd) { maxC = Math.max(maxC, inDeg[nd.data.id]); });
    var godT = Math.max(10, maxC * 0.5);
    var godFiles = [];
    nodes.forEach(function(nd) {
        var c = inDeg[nd.data.id];
        if (c >= godT && c > 0) godFiles.push({ id: nd.data.id, inbound: c });
    });
    godFiles.sort(function(a, b) { return b.inbound - a.inbound; });

    // ---- Unused / orphan files ----
    var unusedFiles = [];
    nodes.forEach(function(nd) {
        if (inDeg[nd.data.id] === 0) unusedFiles.push(nd.data.id);
    });

    // ---- High fan-out (files importing many things) ----
    var sorted_out = nodes.map(function(nd) { return { id: nd.data.id, out: outDeg[nd.data.id] }; })
        .sort(function(a, b) { return b.out - a.out; });
    var fanOutThreshold = Math.max(8, sorted_out.length > 0 ? sorted_out[0].out * 0.4 : 0);
    var highFanOut = sorted_out.filter(function(f) { return f.out >= fanOutThreshold && f.out > 0; });

    // ---- Hub files (high in AND high out) ----
    var hubs = [];
    nodes.forEach(function(nd) {
        var i = inDeg[nd.data.id], o = outDeg[nd.data.id];
        if (i >= 5 && o >= 5) hubs.push({ id: nd.data.id, inbound: i, outbound: o, total: i + o });
    });
    hubs.sort(function(a, b) { return b.total - a.total; });

    // ---- Deep chains ----
    var deepFiles = [];
    nodes.forEach(function(nd) {
        var d = nd.data.depth || 0;
        if (d >= 5) deepFiles.push({ id: nd.data.id, depth: d });
    });
    deepFiles.sort(function(a, b) { return b.depth - a.depth; });

    // ---- High-impact files ----
    var highImpact = [];
    nodes.forEach(function(nd) {
        var imp = nd.data.impact || 0;
        if (imp >= 5) highImpact.push({ id: nd.data.id, impact: imp, pct: +(imp / n * 100).toFixed(1) });
    });
    highImpact.sort(function(a, b) { return b.impact - a.impact; });

    // ---- Unstable files that are heavily depended on ----
    var unstableCore = [];
    nodes.forEach(function(nd) {
        var s = parseFloat(nd.data.stability) || 0;
        var i = inDeg[nd.data.id];
        if (s > 0.7 && i >= 3) unstableCore.push({ id: nd.data.id, stability: s, inbound: i });
    });
    unstableCore.sort(function(a, b) { return b.inbound - a.inbound; });

    // ---- Coupling ----
    var coupling = (data.coupling || []).filter(function(c) { return c.score > 0.1; });

    // ---- Health score (0-100) ----
    var score = 100;
    // Penalize cycles heavily
    score -= Math.min(30, cycles.length * 10);
    // Penalize god files
    score -= Math.min(15, godFiles.length * 5);
    // Penalize high coupling
    var highCoupling = coupling.filter(function(c) { return c.score > 0.3; });
    score -= Math.min(15, highCoupling.length * 5);
    // Penalize many unused files (relative)
    if (n > 0) score -= Math.min(10, Math.round(unusedFiles.length / n * 30));
    // Penalize unstable core files
    score -= Math.min(10, unstableCore.length * 3);
    // Penalize deep chains
    score -= Math.min(10, deepFiles.length * 2);
    // Penalize hub files
    score -= Math.min(10, hubs.length * 3);
    score = Math.max(0, Math.min(100, score));

    return {
        overview: overview,
        score: score,
        cycles: { count: cycles.length, files: Array.from(filesInCycles), chains: cycles },
        godFiles: godFiles,
        unusedFiles: unusedFiles,
        highFanOut: highFanOut.slice(0, 10),
        hubs: hubs.slice(0, 10),
        deepFiles: deepFiles.slice(0, 10),
        highImpact: highImpact.slice(0, 10),
        unstableCore: unstableCore.slice(0, 10),
        coupling: coupling
    };
}

function renderInsightsModal(ins) {
    var body = document.getElementById('insightsBody');
    body.innerHTML = '';

    // ---- Health score + overview ----
    var scoreColor = ins.score >= 80 ? 'var(--success)' : ins.score >= 50 ? 'var(--warning)' : 'var(--danger)';
    var scoreLabel = ins.score >= 80 ? 'Healthy' : ins.score >= 50 ? 'Needs Attention' : 'At Risk';

    body.innerHTML += '<div class="ins-score-row">' +
        '<div class="ins-score-ring" style="--score-color:' + scoreColor + ';--score-pct:' + ins.score + '">' +
            '<svg viewBox="0 0 36 36"><path class="ins-score-bg" d="M18 2.0845a15.9155 15.9155 0 1 1 0 31.831 15.9155 15.9155 0 1 1 0-31.831"/>' +
            '<path class="ins-score-arc" stroke="' + scoreColor + '" stroke-dasharray="' + ins.score + ', 100" d="M18 2.0845a15.9155 15.9155 0 1 1 0 31.831 15.9155 15.9155 0 1 1 0-31.831"/></svg>' +
            '<span class="ins-score-num">' + ins.score + '</span>' +
        '</div>' +
        '<div class="ins-score-info">' +
            '<div class="ins-score-label" style="color:' + scoreColor + '">' + scoreLabel + '</div>' +
            '<div class="ins-overview-stats">' +
                stat(ins.overview.files, 'files') +
                stat(ins.overview.edges, 'dependencies') +
                stat(ins.overview.directories, 'directories') +
                stat(ins.overview.density + '%', 'density') +
            '</div>' +
        '</div>' +
    '</div>';

    // ---- Issue sections ----
    var issues = [];

    if (ins.cycles.count > 0) {
        issues.push(section('danger', 'Circular Dependencies',
            ins.cycles.count + ' cycle' + (ins.cycles.count > 1 ? 's' : '') + ' involving ' + ins.cycles.files.length + ' files',
            'Circular imports make code hard to reason about, test, and refactor. Break cycles by extracting shared logic into a separate module.',
            fileList(ins.cycles.files)));
    }

    if (ins.godFiles.length > 0) {
        issues.push(section('warning', 'God Files',
            ins.godFiles.length + ' file' + (ins.godFiles.length > 1 ? 's' : '') + ' with very high inbound dependencies',
            'These files are imported by a large portion of the codebase. Changes to them have wide blast radius. Consider splitting into smaller, focused modules.',
            fileListWithBadge(ins.godFiles, function(f) { return f.inbound + ' refs'; }, 'badge-orange')));
    }

    if (ins.hubs.length > 0) {
        issues.push(section('warning', 'Hub Files',
            ins.hubs.length + ' file' + (ins.hubs.length > 1 ? 's' : '') + ' with high inbound AND outbound',
            'Hub files are both heavily depended on and depend on many things themselves. They\'re the hardest files to refactor safely.',
            fileListWithBadge(ins.hubs, function(f) { return 'in:' + f.inbound + ' out:' + f.outbound; }, 'badge-orange')));
    }

    if (ins.unstableCore.length > 0) {
        issues.push(section('warning', 'Unstable Core Files',
            ins.unstableCore.length + ' heavily-imported file' + (ins.unstableCore.length > 1 ? 's' : '') + ' with high instability',
            'These files are depended on by many others but also import many things themselves (instability > 0.7). A change in their dependencies ripples outward. Stabilize them by reducing their outbound imports.',
            fileListWithBadge(ins.unstableCore, function(f) { return 'I=' + f.stability + ' · ' + f.inbound + ' refs'; }, 'badge-red')));
    }

    if (ins.coupling.length > 0) {
        var highC = ins.coupling.filter(function(c) { return c.score > 0.3; });
        var medC = ins.coupling.filter(function(c) { return c.score <= 0.3; });
        var couplingHtml = '';
        ins.coupling.forEach(function(c) {
            var color = c.score > 0.3 ? 'badge-red' : 'badge-yellow';
            couplingHtml += '<div class="ins-file-row"><span class="ins-file-name">' + _escapeHtml(c.dir1) + ' ↔ ' + _escapeHtml(c.dir2) + '</span>' +
                '<span class="ins-badge ' + color + '">' + c.cross_edges + ' edges · ' + c.score + '</span></div>';
        });
        issues.push(section(highC.length > 0 ? 'warning' : 'info', 'Directory Coupling',
            ins.coupling.length + ' cross-directory relationship' + (ins.coupling.length > 1 ? 's' : '') + ' above 10%',
            'High coupling between directories suggests they may belong together, or that an interface boundary should be introduced.',
            couplingHtml));
    }

    if (ins.highImpact.length > 0) {
        issues.push(section('info', 'High-Impact Files',
            ins.highImpact.length + ' file' + (ins.highImpact.length > 1 ? 's' : '') + ' affecting 5+ others transitively',
            'Changing these files can trigger a cascade through the dependency graph. Prioritize test coverage and careful review for these.',
            fileListWithBadge(ins.highImpact, function(f) { return f.impact + ' files (' + f.pct + '%)'; }, 'badge-blue')));
    }

    if (ins.highFanOut.length > 0) {
        issues.push(section('info', 'High Fan-Out',
            ins.highFanOut.length + ' file' + (ins.highFanOut.length > 1 ? 's' : '') + ' importing many dependencies',
            'Files that import a lot of things tend to break more often. Consider whether they\'re doing too much and could be split.',
            fileListWithBadge(ins.highFanOut, function(f) { return f.out + ' imports'; }, 'badge-blue')));
    }

    if (ins.deepFiles.length > 0) {
        issues.push(section('info', 'Deep Dependency Chains',
            ins.deepFiles.length + ' file' + (ins.deepFiles.length > 1 ? 's' : '') + ' with import chains 5+ deep',
            'Long transitive chains slow down understanding and make debugging harder. Look for opportunities to flatten the hierarchy.',
            fileListWithBadge(ins.deepFiles, function(f) { return 'depth ' + f.depth; }, 'badge-blue')));
    }

    if (ins.unusedFiles.length > 0) {
        issues.push(section('info', 'Unused Files',
            ins.unusedFiles.length + ' file' + (ins.unusedFiles.length > 1 ? 's' : '') + ' with zero inbound references',
            'These files are never imported. Some may be entry points (main, index) which is normal, but others could be dead code worth removing.',
            fileList(ins.unusedFiles.slice(0, 15), ins.unusedFiles.length > 15 ? '...and ' + (ins.unusedFiles.length - 15) + ' more' : '')));
    }

    if (issues.length === 0) {
        body.innerHTML += '<div class="ins-empty">No issues found — looking clean!</div>';
    } else {
        body.innerHTML += issues.join('');
    }

    // ---- Helper functions ----
    function stat(value, label) {
        return '<div class="ins-stat"><span class="ins-stat-val">' + value + '</span><span class="ins-stat-label">' + label + '</span></div>';
    }

    function section(severity, title, subtitle, advice, content) {
        var icon;
        if (severity === 'danger') icon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
        else if (severity === 'warning') icon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
        else icon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';

        return '<div class="ins-section ins-' + severity + '">' +
            '<div class="ins-section-header">' +
                '<div class="ins-section-icon">' + icon + '</div>' +
                '<div class="ins-section-title">' +
                    '<div class="ins-section-name">' + title + '</div>' +
                    '<div class="ins-section-sub">' + subtitle + '</div>' +
                '</div>' +
            '</div>' +
            '<div class="ins-section-advice">' + advice + '</div>' +
            '<div class="ins-section-content">' + content + '</div>' +
        '</div>';
    }

    function fileList(files, suffix) {
        var html = '';
        files.forEach(function(f) {
            html += '<div class="ins-file-row"><span class="ins-file-name">' + _escapeHtml(f) + '</span></div>';
        });
        if (suffix) html += '<div class="ins-file-row ins-file-more">' + suffix + '</div>';
        return html;
    }

    function fileListWithBadge(files, badgeFn, badgeClass) {
        var html = '';
        files.forEach(function(f) {
            html += '<div class="ins-file-row"><span class="ins-file-name">' + _escapeHtml(f.id) + '</span>' +
                '<span class="ins-badge ' + badgeClass + '">' + badgeFn(f) + '</span></div>';
        });
        return html;
    }
}

// ---- Export ----
function exportInsights(format) {
    if (!_insightsData) return;
    var content, filename, mime;

    if (format === 'json') {
        content = JSON.stringify(_insightsData, null, 2);
        filename = 'depgraph-insights.json';
        mime = 'application/json';
    } else {
        content = buildInsightsMarkdown(_insightsData);
        filename = 'depgraph-insights.md';
        mime = 'text/markdown';
    }

    var blob = new Blob([content], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Exported ' + filename);
}

function buildInsightsMarkdown(ins) {
    var md = '# DepGraph — Project Insights\n\n';
    md += '**Health Score: ' + ins.score + '/100**\n\n';
    md += '| Metric | Value |\n|--------|-------|\n';
    md += '| Files | ' + ins.overview.files + ' |\n';
    md += '| Dependencies | ' + ins.overview.edges + ' |\n';
    md += '| Directories | ' + ins.overview.directories + ' |\n';
    md += '| Density | ' + ins.overview.density + '% |\n\n';

    if (ins.cycles.count > 0) {
        md += '## Circular Dependencies\n\n';
        md += ins.cycles.count + ' cycle(s) involving ' + ins.cycles.files.length + ' files:\n\n';
        ins.cycles.files.forEach(function(f) { md += '- `' + f + '`\n'; });
        md += '\n';
    }

    if (ins.godFiles.length > 0) {
        md += '## God Files\n\n';
        ins.godFiles.forEach(function(f) { md += '- `' + f.id + '` — ' + f.inbound + ' inbound refs\n'; });
        md += '\n';
    }

    if (ins.hubs.length > 0) {
        md += '## Hub Files\n\n';
        ins.hubs.forEach(function(f) { md += '- `' + f.id + '` — in:' + f.inbound + ' out:' + f.outbound + '\n'; });
        md += '\n';
    }

    if (ins.unstableCore.length > 0) {
        md += '## Unstable Core Files\n\n';
        ins.unstableCore.forEach(function(f) { md += '- `' + f.id + '` — instability=' + f.stability + ', ' + f.inbound + ' refs\n'; });
        md += '\n';
    }

    if (ins.coupling.length > 0) {
        md += '## Directory Coupling\n\n';
        ins.coupling.forEach(function(c) { md += '- `' + c.dir1 + '` ↔ `' + c.dir2 + '` — ' + c.cross_edges + ' edges, score=' + c.score + '\n'; });
        md += '\n';
    }

    if (ins.highImpact.length > 0) {
        md += '## High-Impact Files\n\n';
        ins.highImpact.forEach(function(f) { md += '- `' + f.id + '` — affects ' + f.impact + ' files (' + f.pct + '%)\n'; });
        md += '\n';
    }

    if (ins.highFanOut.length > 0) {
        md += '## High Fan-Out\n\n';
        ins.highFanOut.forEach(function(f) { md += '- `' + f.id + '` — ' + f.out + ' imports\n'; });
        md += '\n';
    }

    if (ins.deepFiles.length > 0) {
        md += '## Deep Dependency Chains\n\n';
        ins.deepFiles.forEach(function(f) { md += '- `' + f.id + '` — depth ' + f.depth + '\n'; });
        md += '\n';
    }

    if (ins.unusedFiles.length > 0) {
        md += '## Unused Files\n\n';
        ins.unusedFiles.forEach(function(f) { md += '- `' + f + '`\n'; });
        md += '\n';
    }

    md += '\n---\n*Generated by DepGraph*\n';
    return md;
}
