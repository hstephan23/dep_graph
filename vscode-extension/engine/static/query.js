/**
 * Query Terminal Module
 *
 * Provides query parsing and execution for the dependency graph visualization.
 * Supports filtering files by patterns, metrics, cycles, and directories.
 *
 * State variables: _queryMode, _queryActive, _queryHistory, _queryHistoryIndex
 * Requires globals from state.js: cy, currentGraphData, pathHighlightActive
 */

// QUERY TERMINAL
// ================================================================
let _queryMode = 'highlight'; // 'highlight' or 'isolate'
let _queryActive = false;
let _queryHistory = [];
let _queryHistoryIndex = -1;

function toggleQueryTerminal() {
    const el = document.getElementById('queryTerminal');
    el.classList.toggle('open');
    if (el.classList.contains('open')) {
        setTimeout(() => document.getElementById('queryInput').focus(), 100);
    }
}

function setQueryMode(mode) {
    _queryMode = mode;
    document.querySelectorAll('.query-mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
    // Re-apply current query if active
    if (_queryActive) {
        const input = document.getElementById('queryInput');
        if (input.value.trim()) executeQuery(input.value.trim());
    }
}

function handleQueryKeydown(e) {
    if (e.key === 'Enter') {
        const q = e.target.value.trim();
        if (q) {
            // Add to history
            if (!_queryHistory.length || _queryHistory[_queryHistory.length - 1] !== q) {
                _queryHistory.push(q);
            }
            _queryHistoryIndex = _queryHistory.length;
            executeQuery(q);
        }
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (_queryHistory.length && _queryHistoryIndex > 0) {
            _queryHistoryIndex--;
            e.target.value = _queryHistory[_queryHistoryIndex];
        }
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (_queryHistoryIndex < _queryHistory.length - 1) {
            _queryHistoryIndex++;
            e.target.value = _queryHistory[_queryHistoryIndex];
        } else {
            _queryHistoryIndex = _queryHistory.length;
            e.target.value = '';
        }
    } else if (e.key === 'Escape') {
        if (_queryActive) { clearQuery(); e.stopPropagation(); }
        else { toggleQueryTerminal(); e.stopPropagation(); }
    }
}

function runExampleQuery(el) {
    const code = el.querySelector('code');
    if (!code) return;
    const q = code.textContent;
    document.getElementById('queryInput').value = q;
    executeQuery(q);
}

function clearQuery() {
    _queryActive = false;
    document.getElementById('queryInput').value = '';
    document.getElementById('queryResultCount').classList.remove('visible');
    document.getElementById('queryResultsList').classList.remove('visible');
    document.getElementById('queryResultsList').innerHTML = '';
    document.getElementById('queryError').classList.remove('visible');
    document.getElementById('queryHints').style.display = '';
    document.querySelector('.query-clear-btn').classList.remove('visible');

    // Restore graph
    if (cy) {
        cy.elements().removeStyle();
        cy.nodes().forEach(n => n.style('display', 'element'));
        pathHighlightActive = false;
    }
}

// --- Query Parser ---
/**
 * Parse a user-supplied string into a RegExp.
 * Accepts /pattern/flags syntax for explicit regex, or a plain string
 * which is treated as a case-insensitive substring match (like before)
 * unless it contains regex-special characters, in which case it's
 * compiled as a regex so users can write things like `.*Controller.*`
 * without the / delimiters.
 */
function _tryParseRegex(input) {
    // Explicit /regex/flags syntax
    const delimited = input.match(/^\/(.+)\/([gimsuy]*)$/);
    if (delimited) {
        try {
            return { regex: new RegExp(delimited[1], delimited[2] || 'i') };
        } catch (e) {
            return { error: 'Invalid regex: ' + e.message };
        }
    }

    // If the string looks like it contains regex metacharacters, compile it
    const hasRegexChars = /[.*+?^${}()|[\]\\]/.test(input);
    if (hasRegexChars) {
        try {
            return { regex: new RegExp(input, 'i') };
        } catch (e) {
            return { error: 'Invalid regex: ' + e.message };
        }
    }

    // Plain substring — wrap in a case-insensitive regex
    return { regex: new RegExp(_escapeRegex(input), 'i') };
}

function _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseQuery(raw) {
    const q = raw.trim().toLowerCase();

    // "files in cycles"
    if (/^files?\s+in\s+cycles?$/i.test(q)) {
        return { type: 'cycles' };
    }

    // "files with no downstream" / "files with no inbound"
    if (/^files?\s+with\s+no\s+(downstream|inbound)$/i.test(q)) {
        return { type: 'no_downstream' };
    }

    // "files with no upstream" / "files with no outbound"
    if (/^files?\s+with\s+no\s+(upstream|outbound)$/i.test(q)) {
        return { type: 'no_upstream' };
    }

    // "files matching <pattern>" — supports regex (e.g. /Controller\.js$/) or plain substring
    // Use raw input (not lowercased q) so regex patterns preserve their intended case
    const matchPat = raw.trim().match(/^files?\s+matching\s+(.+)$/i);
    if (matchPat) {
        const patStr = matchPat[1].trim();
        const parsed = _tryParseRegex(patStr);
        if (parsed.error) return { type: 'error', message: parsed.error };
        return { type: 'matching', regex: parsed.regex, raw: patStr };
    }

    // "files in <directory>"
    const inDir = q.match(/^files?\s+in\s+(?!cycles)(.+)$/i);
    if (inDir) {
        return { type: 'in_dir', dir: inDir[1].trim() };
    }

    // "files where <conditions>" — use raw input to preserve case in regex patterns
    const wherePat = raw.trim().match(/^files?\s+where\s+(.+)$/i);
    if (wherePat) {
        return parseWhereConditions(wherePat[1]);
    }

    // Try just bare conditions: "inbound > 3"
    if (/^(inbound|outbound|depth|impact|stability)\s*[><=!]/.test(q)) {
        return parseWhereConditions(q);
    }

    return { type: 'error', message: 'Unrecognized query. Try: files where inbound > 3, files in cycles, files matching /pattern/' };
}

function parseWhereConditions(str) {
    const parts = str.split(/\s+and\s+/i);
    const conditions = [];

    for (const part of parts) {
        const trimmed = part.trim();

        // "name matching <pattern>" condition — regex on file name
        const nameMatch = trimmed.match(/^name\s+matching\s+(.+)$/i);
        if (nameMatch) {
            const parsed = _tryParseRegex(nameMatch[1].trim());
            if (parsed.error) return { type: 'error', message: parsed.error };
            conditions.push({ type: 'name', regex: parsed.regex });
            continue;
        }

        // "in cycles" condition
        if (/^in\s+cycles?$/i.test(trimmed)) {
            conditions.push({ type: 'in_cycles' });
            continue;
        }

        // Standard metric condition
        const m = trimmed.match(/^(inbound|outbound|depth|impact|stability)\s*(>=|<=|!=|>|<|=)\s*([\d.]+)$/);
        if (!m) {
            return { type: 'error', message: `Invalid condition: "${trimmed}". Use: metric op value (e.g., inbound > 3), name matching <regex>, or in cycles` };
        }
        conditions.push({
            type: 'metric',
            metric: m[1],
            op: m[2],
            value: parseFloat(m[3])
        });
    }

    return { type: 'where', conditions };
}

// --- Query Executor ---
function executeQuery(raw) {
    if (!cy || !currentGraphData) {
        showQueryError('No graph loaded. Generate a graph first.');
        return;
    }

    const parsed = parseQuery(raw);

    if (parsed.type === 'error') {
        showQueryError(parsed.message);
        return;
    }

    // Build node metrics
    const inDeg = {};
    const outDeg = {};
    currentGraphData.nodes.forEach(n => { inDeg[n.data.id] = 0; outDeg[n.data.id] = 0; });
    currentGraphData.edges.forEach(e => {
        if (inDeg[e.data.target] !== undefined) inDeg[e.data.target]++;
        if (outDeg[e.data.source] !== undefined) outDeg[e.data.source]++;
    });

    // Build cycle set
    const cycleNodes = new Set();
    if (currentGraphData.cycles) {
        currentGraphData.cycles.forEach(cycle => cycle.forEach(nid => cycleNodes.add(nid)));
    }

    // Evaluate each node
    const matches = [];

    currentGraphData.nodes.forEach(n => {
        const id = n.data.id;
        const metrics = {
            inbound: inDeg[id] || 0,
            outbound: outDeg[id] || 0,
            depth: n.data.depth || 0,
            impact: n.data.impact || 0,
            stability: parseFloat(n.data.stability) || 0,
        };

        let match = false;

        switch (parsed.type) {
            case 'cycles':
                match = cycleNodes.has(id);
                break;
            case 'no_downstream':
                match = metrics.inbound === 0;
                break;
            case 'no_upstream':
                match = metrics.outbound === 0;
                break;
            case 'matching':
                match = parsed.regex.test(id);
                break;
            case 'in_dir':
                match = id.toLowerCase().startsWith(parsed.dir.toLowerCase());
                break;
            case 'where':
                match = parsed.conditions.every(c => {
                    if (c.type === 'name') return c.regex.test(id);
                    if (c.type === 'in_cycles') return cycleNodes.has(id);
                    const v = metrics[c.metric];
                    switch (c.op) {
                        case '>':  return v > c.value;
                        case '<':  return v < c.value;
                        case '>=': return v >= c.value;
                        case '<=': return v <= c.value;
                        case '=':  return v === c.value;
                        case '!=': return v !== c.value;
                        default:   return false;
                    }
                });
                break;
        }

        if (match) {
            matches.push({ id, metrics, inCycle: cycleNodes.has(id) });
        }
    });

    // Sort by inbound desc
    matches.sort((a, b) => b.metrics.inbound - a.metrics.inbound);

    // Display results
    showQueryResults(matches, parsed);

    // Apply to graph
    applyQueryToGraph(matches.map(m => m.id));
}

function showQueryError(msg) {
    const errEl = document.getElementById('queryError');
    errEl.textContent = msg;
    errEl.classList.add('visible');
    document.getElementById('queryResultsList').classList.remove('visible');
    document.getElementById('queryResultCount').classList.remove('visible');
    document.getElementById('queryHints').style.display = 'none';
}

function showQueryResults(matches, parsed) {
    document.getElementById('queryError').classList.remove('visible');
    document.getElementById('queryHints').style.display = 'none';
    document.querySelector('.query-clear-btn').classList.add('visible');

    const countEl = document.getElementById('queryResultCount');
    countEl.textContent = matches.length + ' match' + (matches.length !== 1 ? 'es' : '');
    countEl.classList.add('visible');

    const listEl = document.getElementById('queryResultsList');
    listEl.innerHTML = '';
    listEl.classList.add('visible');

    matches.forEach(m => {
        const item = document.createElement('div');
        item.className = 'query-result-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'query-result-file';
        nameSpan.textContent = m.id;

        const badgesDiv = document.createElement('span');
        badgesDiv.className = 'query-result-badges';

        // Show relevant metric badges
        const addBadge = (text, cls) => {
            const b = document.createElement('span');
            b.className = 'query-result-badge' + (cls ? ' ' + cls : '');
            b.textContent = text;
            badgesDiv.appendChild(b);
        };

        if (m.inCycle) addBadge('cycle', 'badge-cycle');
        addBadge('in:' + m.metrics.inbound);
        addBadge('out:' + m.metrics.outbound);

        item.appendChild(nameSpan);
        item.appendChild(badgesDiv);

        // Click to zoom
        item.onclick = () => {
            const node = cy.getElementById(m.id);
            if (node.length) {
                cy.animate({ center: { eles: node }, zoom: 1.5 }, { duration: 400 });
            }
        };

        listEl.appendChild(item);
    });

    _queryActive = true;
}

function applyQueryToGraph(matchIds) {
    if (!cy) return;
    const matchSet = new Set(matchIds);

    if (_queryMode === 'highlight') {
        // Dim everything, highlight matches
        cy.elements().style('opacity', 0.12);
        cy.nodes().forEach(n => {
            n.style('display', 'element');
            if (matchSet.has(n.id())) {
                n.style({ opacity: 1, 'border-width': 4, 'border-color': '#10b981' });
            }
        });
        // Show edges between matched nodes
        cy.edges().forEach(e => {
            if (matchSet.has(e.source().id()) && matchSet.has(e.target().id())) {
                e.style({ opacity: 0.7 });
            }
        });
        pathHighlightActive = true;

        // Fit view to matched nodes
        const matchedEles = cy.nodes().filter(n => matchSet.has(n.id()));
        if (matchedEles.length) {
            cy.animate({ fit: { eles: matchedEles, padding: 80 } }, { duration: 500 });
        }
    } else {
        // Isolate: hide non-matches
        cy.elements().removeStyle();
        pathHighlightActive = false;
        cy.nodes().forEach(n => {
            if (matchSet.has(n.id())) {
                n.style({ 'display': 'element', 'border-width': 3, 'border-color': '#10b981' });
            } else {
                n.style('display', 'none');
            }
        });
        // Edges auto-hide when both endpoints are hidden

        // Fit to visible
        const visible = cy.nodes().filter(n => matchSet.has(n.id()));
        if (visible.length) {
            cy.animate({ fit: { eles: visible, padding: 80 } }, { duration: 500 });
        }
    }
}
