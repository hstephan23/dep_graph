// STORY MODE
// Story-driven interactive walkthrough of dependency graph analysis
// Includes step management, UI updates, and graph animation
// All global state variables (currentGraphData, cy, pathHighlightActive, etc.) imported from state.js

let storySteps = [];
let storyIndex = -1;

// Step type → icon + accent color
const STORY_THEME = {
    overview:     { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>', color: '#6366f1' },
    entry_points: { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>', color: '#22c55e' },
    hubs:         { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>', color: '#f97316' },
    depth:        { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>', color: '#8b5cf6' },
    cycles:       { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6"/><path d="M2.5 22v-6h6"/><path d="M2.5 15.5A10 10 0 0 1 5.68 5.68"/><path d="M21.5 8.5a10 10 0 0 1-3.18 9.82"/></svg>', color: '#ef4444' },
    risks:        { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>', color: '#eab308' },
    coupling:     { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>', color: '#06b6d4' },
    summary:      { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>', color: '#10b981' },
};

function storyLoad() {
    if (!currentGraphData) { showToast('Generate a graph first'); return; }

    var contentEl = document.getElementById('story-content');
    contentEl.innerHTML = '<div class="panel-hint" style="opacity:0.6;">Generating story...</div>';

    fetch('/api/story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._csrfHeaders() },
        body: JSON.stringify({ graph: currentGraphData }),
    })
    .then(function(r) {
        if (!r.ok) {
            return r.text().then(function(t) {
                var msg = 'Server error ' + r.status;
                try { msg = JSON.parse(t).error || msg; } catch(e) {}
                throw new Error(msg);
            });
        }
        return r.json();
    })
    .then(function(data) {
        if (data.error) { showToast('Error: ' + data.error); contentEl.innerHTML = ''; return; }
        storySteps = data.steps || [];
        storyIndex = -1;
        storyUpdateCounter();
        document.getElementById('storyPrevBtn').disabled = true;
        document.getElementById('storyNextBtn').disabled = storySteps.length === 0;
        contentEl.innerHTML = '';

        if (storySteps.length === 0) {
            contentEl.innerHTML = '<div class="panel-hint">No story to tell \u2014 the graph is empty.</div>';
            return;
        }

        // Render all step cards (collapsed), first one will expand on storyNext
        var html = '';
        storySteps.forEach(function(step, i) {
            var theme = STORY_THEME[step.step_type] || STORY_THEME.overview;
            html += '<div class="story-card" id="story-card-' + i + '" data-step="' + i + '" onclick="storyGoTo(' + i + ')">'
                + '<div class="story-card-marker" style="background:' + theme.color + ';">' + (i + 1) + '</div>'
                + '<div class="story-card-body">'
                + '<div class="story-card-title">' + theme.icon + ' ' + step.title + '</div>'
                + '<div class="story-card-narrative">' + step.narrative + '</div>'
                + '</div></div>';
        });
        contentEl.innerHTML = html;

        // Auto-advance to first step
        storyNext();
        showToast('Story loaded \u2014 ' + storySteps.length + ' steps');
    })
    .catch(function(err) {
        showToast('Error: ' + (err.message || 'Failed to generate story'), 4000);
        contentEl.innerHTML = '<div class="panel-hint" style="color:var(--danger);">' + (err.message || 'Failed to generate story') + '</div>';
    });
}

function storyGoTo(index) {
    if (index < 0 || index >= storySteps.length) return;
    storyIndex = index;
    storyUpdateCounter();
    storyUpdateCards();
    storyAnimateStep(storySteps[index]);

    document.getElementById('storyPrevBtn').disabled = index <= 0;
    document.getElementById('storyNextBtn').disabled = index >= storySteps.length - 1;

    storyUpdateProgressBar();
}

function storyNext() {
    if (storyIndex < storySteps.length - 1) {
        storyGoTo(storyIndex + 1);
    }
}

function storyPrev() {
    if (storyIndex > 0) storyGoTo(storyIndex - 1);
}

function storyUpdateCounter() {
    var el = document.getElementById('storyCounter');
    if (el) el.textContent = (storyIndex + 1) + ' / ' + storySteps.length;
}

function storyUpdateProgressBar() {
    var bar = document.getElementById('storyProgressBar');
    if (!bar || !storySteps.length) return;
    var pct = ((storyIndex + 1) / storySteps.length) * 100;
    bar.style.width = pct + '%';
}

function storyUpdateCards() {
    // Highlight active card, dim others
    storySteps.forEach(function(_, i) {
        var card = document.getElementById('story-card-' + i);
        if (!card) return;
        if (i === storyIndex) {
            card.classList.add('active');
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            card.classList.remove('active');
        }
    });
}

function storyAnimateStep(step) {
    if (!cy) return;
    var theme = STORY_THEME[step.step_type] || STORY_THEME.overview;

    // Reset graph styles
    cy.elements().removeStyle();
    pathHighlightActive = false;

    if (!step.highlight_nodes.length && !step.highlight_edges.length) {
        // Overview / summary — just fit everything
        cy.animate({ fit: { eles: cy.elements(), padding: 60 } }, { duration: 600 });
        return;
    }

    // Dim everything
    cy.elements().style('opacity', 0.1);

    // Highlight nodes
    var highlightedNodes = cy.collection();
    step.highlight_nodes.forEach(function(nid) {
        var n = cy.getElementById(nid);
        if (n.length) {
            n.style({ opacity: 1, 'border-width': 4, 'border-color': theme.color });
            highlightedNodes = highlightedNodes.union(n);
        }
    });

    // Highlight edges
    step.highlight_edges.forEach(function(e) {
        cy.edges().forEach(function(edge) {
            if (edge.source().id() === e.source && edge.target().id() === e.target) {
                edge.style({ opacity: 1, 'line-color': theme.color, 'target-arrow-color': theme.color, width: 5 });
                // Also ensure the connected nodes are visible
                edge.source().style('opacity', 1);
                edge.target().style('opacity', 1);
                highlightedNodes = highlightedNodes.union(edge.source()).union(edge.target());
            }
        });
    });

    pathHighlightActive = true;

    // Zoom to highlighted elements
    if (step.zoom_target) {
        var target = cy.getElementById(step.zoom_target);
        if (target.length) {
            cy.animate({ center: { eles: target }, zoom: 1.4 }, { duration: 600 });
        }
    } else if (highlightedNodes.length) {
        cy.animate({ fit: { eles: highlightedNodes, padding: 80 } }, { duration: 600 });
    }
}
