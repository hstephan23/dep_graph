/**
 * analysis.js
 * Dependency analysis module: Rules system and depth warnings
 *
 * Extracted from app.js - contains:
 * - Dependency rules system (addRule, removeRule, checkRules, etc.)
 * - Depth warning system (depth analysis and critical path detection)
 *
 * Global dependencies: cy, currentGraphData, _csrfHeaders, showToast, _escapeHtml (from state.js)
 */

// ============================================================
// DEPENDENCY RULES SYSTEM
// ============================================================

let depRules = [];
let ruleViolations = [];

function addRule() {
    const type = document.getElementById('ruleType').value;
    const source = document.getElementById('ruleSource').value.trim();
    const target = document.getElementById('ruleTarget').value.trim();
    if (!source || !target) { showToast('Both source and target patterns are required'); return; }
    depRules.push({ type, source, target });
    document.getElementById('ruleSource').value = '';
    document.getElementById('ruleTarget').value = '';
    renderRulesList();
    showToast('Rule added');
}

function removeRule(idx) {
    depRules.splice(idx, 1);
    renderRulesList();
    clearRuleViolations();
}

function renderRulesList() {
    const list = document.getElementById('rules-list');
    list.innerHTML = '';
    document.getElementById('ruleCountBadge').textContent = depRules.length;
    if (!depRules.length) {
        list.innerHTML = '<div class="panel-hint">No rules defined yet.</div>';
        return;
    }
    depRules.forEach((rule, i) => {
        const div = document.createElement('div');
        div.className = 'rule-card';
        const typeLabel = rule.type === 'forbidden' ? 'FORBIDDEN' : 'REQUIRED ONLY';
        const typeClass = rule.type === 'forbidden' ? 'rule-type-forbidden' : 'rule-type-required';
        div.innerHTML = `
            <div class="rule-card-header">
                <span class="rule-type-badge ${typeClass}">${typeLabel}</span>
                <button class="rule-remove-btn" onclick="removeRule(${i})" title="Remove rule">&times;</button>
            </div>
            <div class="rule-card-body">${rule.source} <span class="rule-arrow-small">\u2192</span> ${rule.target}</div>
        `;
        list.appendChild(div);
    });
}

function checkRules() {
    if (!depRules.length) { showToast('Add at least one rule first'); return; }
    if (!currentGraphData) { showToast('Generate a graph first'); return; }
    _fetchWithTimeout('/api/rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ..._csrfHeaders() },
        body: JSON.stringify({ rules: depRules, graph: currentGraphData }),
    }).then(r => r.json()).then(data => {
        ruleViolations = data.violations || [];
        renderRuleViolations();
        applyRuleBadges();
        if (!ruleViolations.length) showToast('No violations found!');
        else showToast(`Found ${ruleViolations.length} violation${ruleViolations.length > 1 ? 's' : ''}`);
    }).catch(err => _handleApiError(err, 'Failed to check rules.'));
}

function renderRuleViolations() {
    const list = document.getElementById('rule-violations-list');
    list.innerHTML = '';
    document.getElementById('ruleViolationBadge').textContent = ruleViolations.length;
    if (!ruleViolations.length) {
        list.innerHTML = '<div class="metric-row"><span class="metric-label" style="color:var(--success);">All rules pass</span></div>';
        return;
    }
    ruleViolations.forEach(v => {
        const div = document.createElement('div');
        div.className = 'violation-row';
        const icon = v.rule_type === 'forbidden'
            ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>'
            : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/></svg>';
        div.innerHTML = `${icon} <span class="rule-violation-file">${v.source}</span> <span style="color:var(--text-muted);">\u2192</span> <span class="rule-violation-file">${v.target}</span>`;
        div.title = v.rule_desc;
        div.onclick = () => {
            clearPathHighlight();
            cy.edges().forEach(e => {
                if (e.source().id() === v.source && e.target().id() === v.target)
                    e.style({ 'line-color': '#ef4444', 'target-arrow-color': '#ef4444', width: 6 });
            });
            const src = cy.getElementById(v.source);
            if (src.length) cy.animate({ center: { eles: src }, zoom: 1.5 }, { duration: 400 });
        };
        list.appendChild(div);
    });
}

function applyRuleBadges() {
    if (!cy || !ruleViolations.length) return;
    // Count violations per node
    const counts = {};
    ruleViolations.forEach(v => {
        counts[v.source] = (counts[v.source] || 0) + 1;
    });
    // Remove existing badge overlays
    document.querySelectorAll('.rule-badge-overlay').forEach(el => el.remove());
    const container = document.getElementById('cy');
    // Add badge overlays positioned on graph nodes
    Object.entries(counts).forEach(([nodeId, count]) => {
        const node = cy.getElementById(nodeId);
        if (!node.length) return;
        const badge = document.createElement('div');
        badge.className = 'rule-badge-overlay';
        badge.id = 'rule-badge-' + nodeId.replace(/[^a-zA-Z0-9_-]/g, '_');
        badge.textContent = count;
        badge.title = `${count} rule violation${count > 1 ? 's' : ''} in ${nodeId}`;
        container.appendChild(badge);

        const updatePos = () => {
            const pos = node.renderedPosition();
            const w = node.renderedWidth();
            badge.style.left = (pos.x + w / 2 - 8) + 'px';
            badge.style.top = (pos.y - w / 2 - 8) + 'px';
        };
        updatePos();
        cy.on('pan zoom resize', updatePos);
    });
    // Tint violating edges red + dashed
    ruleViolations.forEach(v => {
        cy.edges().forEach(e => {
            if (e.source().id() === v.source && e.target().id() === v.target)
                e.style({ 'line-color': '#ef4444', 'target-arrow-color': '#ef4444', width: 4, 'line-style': 'dashed' });
        });
    });
}

function clearRuleViolations() {
    ruleViolations = [];
    document.getElementById('ruleViolationBadge').textContent = '0';
    document.getElementById('rule-violations-list').innerHTML = '<div class="panel-hint">Run "Check All" to validate rules against the graph.</div>';
    document.querySelectorAll('.rule-badge-overlay').forEach(el => el.remove());
    if (cy) cy.edges().removeStyle();
}

// ============================================================
// DEPTH WARNING SYSTEM
// ============================================================

const _depthConfig = {
    reachWarn: 30,
    reachCrit: 50,
    depthWarn: 5,
    depthCrit: 8,
};

let _depthWarnings = [];

function _computeClientDepthWarnings(data) {
    if (!data || !data.nodes) return [];
    const total = data.nodes.length || 1;
    const warnings = [];
    data.nodes.forEach(n => {
        const d = n.data;
        const depth = d.depth || 0;
        const impact = d.impact || 0;
        const reachPct = Math.round(impact / total * 1000) / 10;
        let severity = null;
        const reasons = [];

        if (reachPct >= _depthConfig.reachCrit) {
            severity = 'critical';
            reasons.push('pulls in ' + reachPct + '% of codebase');
        } else if (reachPct >= _depthConfig.reachWarn) {
            severity = 'warning';
            reasons.push('pulls in ' + reachPct + '% of codebase');
        }

        if (depth >= _depthConfig.depthCrit) {
            severity = 'critical';
            reasons.push('dependency chain ' + depth + ' levels deep');
        } else if (depth >= _depthConfig.depthWarn) {
            if (severity !== 'critical') severity = 'warning';
            reasons.push('dependency chain ' + depth + ' levels deep');
        }

        if (severity) {
            warnings.push({ file: d.id, severity, depth, impact, reach_pct: reachPct, reasons });
        }
    });
    warnings.sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
        return b.reach_pct - a.reach_pct;
    });
    return warnings;
}

function showDepthWarnings(data) {
    _depthWarnings = _computeClientDepthWarnings(data);
    const banner = document.getElementById('depthWarningBanner');
    const details = document.getElementById('depthWarningDetails');
    const expandBtn = document.getElementById('depthWarningExpandBtn');

    if (!_depthWarnings.length) {
        banner.style.display = 'none';
        return;
    }

    const critCount = _depthWarnings.filter(w => w.severity === 'critical').length;
    const warnCount = _depthWarnings.filter(w => w.severity === 'warning').length;

    const titleEl = document.getElementById('depthWarningTitle');
    const summaryEl = document.getElementById('depthWarningSummary');

    if (critCount > 0) {
        banner.className = 'depth-warning-banner depth-warning-critical';
        titleEl.textContent = critCount + ' Critical';
    } else {
        banner.className = 'depth-warning-banner depth-warning-warn';
        titleEl.textContent = warnCount + ' Warning' + (warnCount !== 1 ? 's' : '');
    }

    const parts = [];
    if (critCount) parts.push(critCount + ' critical');
    if (warnCount) parts.push(warnCount + ' warning' + (warnCount !== 1 ? 's' : ''));
    const topFile = _depthWarnings[0];
    summaryEl.textContent = parts.join(', ') + ' — worst: ' + topFile.file.split('/').pop() + ' (' + topFile.reasons.join(', ') + ')';

    // Build details list
    details.innerHTML = '';
    _depthWarnings.forEach(w => {
        const row = document.createElement('div');
        row.className = 'depth-warning-row depth-warning-row-' + w.severity;
        row.innerHTML =
            '<span class="depth-warning-row-badge badge-' + (w.severity === 'critical' ? 'red' : 'yellow') + '">' + w.severity + '</span>' +
            '<span class="depth-warning-row-file" title="Click to focus">' + _escapeHtml(w.file) + '</span>' +
            '<span class="depth-warning-row-reasons">' + _escapeHtml(w.reasons.join(' · ')) + '</span>' +
            '<span class="depth-warning-row-stats">' +
                '<span class="depth-warning-stat">Reach ' + w.reach_pct + '%</span>' +
                '<span class="depth-warning-stat">Depth ' + w.depth + '</span>' +
            '</span>';
        row.querySelector('.depth-warning-row-file').onclick = () => {
            if (typeof cy !== 'undefined' && cy) {
                const node = cy.getElementById(w.file);
                if (node.length) cy.animate({ center: { eles: node }, zoom: 1.5 }, { duration: 400 });
            }
        };
        details.appendChild(row);
    });

    details.style.display = 'none';
    expandBtn.classList.remove('expanded');
    banner.style.display = 'flex';
}

function toggleDepthWarningDetails() {
    const details = document.getElementById('depthWarningDetails');
    const expandBtn = document.getElementById('depthWarningExpandBtn');
    const isOpen = details.style.display !== 'none';
    details.style.display = isOpen ? 'none' : 'block';
    expandBtn.classList.toggle('expanded', !isOpen);
}

function dismissDepthWarnings() {
    document.getElementById('depthWarningBanner').style.display = 'none';
}

function openDepthSettings() {
    document.getElementById('reachWarnSlider').value = _depthConfig.reachWarn;
    document.getElementById('reachWarnVal').textContent = _depthConfig.reachWarn + '%';
    document.getElementById('reachCritSlider').value = _depthConfig.reachCrit;
    document.getElementById('reachCritVal').textContent = _depthConfig.reachCrit + '%';
    document.getElementById('depthWarnSlider').value = _depthConfig.depthWarn;
    document.getElementById('depthWarnVal').textContent = _depthConfig.depthWarn;
    document.getElementById('depthCritSlider').value = _depthConfig.depthCrit;
    document.getElementById('depthCritVal').textContent = _depthConfig.depthCrit;
    document.getElementById('depthSettingsOverlay').style.display = 'flex';
}

function closeDepthSettings() {
    document.getElementById('depthSettingsOverlay').style.display = 'none';
}

function resetDepthSettings() {
    _depthConfig.reachWarn = 30; _depthConfig.reachCrit = 50;
    _depthConfig.depthWarn = 5; _depthConfig.depthCrit = 8;
    openDepthSettings(); // refresh sliders
}

function applyDepthSettings() {
    _depthConfig.reachWarn = parseInt(document.getElementById('reachWarnSlider').value);
    _depthConfig.reachCrit = parseInt(document.getElementById('reachCritSlider').value);
    _depthConfig.depthWarn = parseInt(document.getElementById('depthWarnSlider').value);
    _depthConfig.depthCrit = parseInt(document.getElementById('depthCritSlider').value);

    // Ensure warn < crit
    if (_depthConfig.reachWarn >= _depthConfig.reachCrit) {
        _depthConfig.reachWarn = Math.max(10, _depthConfig.reachCrit - 10);
    }
    if (_depthConfig.depthWarn >= _depthConfig.depthCrit) {
        _depthConfig.depthWarn = Math.max(2, _depthConfig.depthCrit - 1);
    }

    closeDepthSettings();
    if (currentGraphData) showDepthWarnings(currentGraphData);
    showToast('Thresholds updated');
}
