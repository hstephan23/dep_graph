// ================================================================
// GUIDED TOUR — Step-by-step walkthrough
// ================================================================
// Shows one feature at a time with Back / Next navigation.
// The active element gets a spotlight cutout in the overlay.
// ================================================================

const Tour = (() => {
    'use strict';

    const steps = [
        {
            target: '.brand',
            label: 'Welcome to DepGraph',
            desc: 'Upload any project and instantly visualize how your files depend on each other. Let\u2019s walk through the key features.',
            placement: 'bottom-start',
        },
        {
            target: '.toolbar-top .dropdown:first-of-type',
            label: 'Filters',
            desc: 'Toggle languages, hide system imports, filter by subdirectory, or isolate specific parts of your codebase.',
            placement: 'bottom-start',
        },
        {
            target: '.toolbar-group:has([name="layoutMode"])',
            label: 'Layout Modes',
            desc: 'Choose how nodes are arranged: Force (organic), Hierarchy (top-down DAG), or Concentric (rings). The lens icon enables focus-magnification.',
            placement: 'bottom',
        },
        {
            target: '.toolbar-group:has([name="viewMode"])',
            label: 'View Modes',
            desc: 'Switch between an interactive Graph, a Treemap heat-map, or a Matrix grid showing every file-to-file dependency at a glance.',
            placement: 'bottom',
        },
        {
            target: '#cy',
            label: 'Graph Canvas',
            desc: 'The main stage. Click a node to trace dependencies, double-click to preview source code, scroll to zoom, and drag to rearrange.',
            placement: 'center',
        },
        {
            target: '.btn[onclick*="toggleQueryTerminal"]',
            label: 'Query Terminal',
            desc: 'Write powerful queries like \u201Cfiles where inbound > 3\u201D or \u201Cfiles in cycles\u201D to filter and highlight matching nodes.',
            placement: 'bottom-end',
        },
        {
            target: '.btn-upload',
            label: 'Upload',
            desc: 'Drop in a ZIP or individual source files to generate a dependency graph from any project \u2014 no server access needed.',
            placement: 'bottom-end',
        },
        {
            target: '.dropdown:has(.export-menu)',
            label: 'Export',
            desc: 'Save your graph as JSON, PNG, Graphviz DOT, or Mermaid for docs and presentations.',
            placement: 'bottom-end',
        },
        {
            target: '#sidebar .sidebar-tabs-wrap',
            label: 'Sidebar Tools',
            desc: 'Deep-dive tools in two rows \u2014 Inspect (Refs, Analysis, Unused, Blast) and Tools (Layers, Rules, Path, Diff, Simulate, Story).',
            placement: 'left',
        },
        {
            target: '#minimap',
            label: 'Minimap',
            desc: 'A bird\u2019s-eye view of the full graph. Drag the viewport rectangle to navigate large codebases quickly.',
            placement: 'left',
        },
        {
            target: '.graph-status-bar',
            label: 'Legend',
            desc: 'Once a graph is loaded, a legend appears here along the bottom-left showing the color key: upstream (blue), downstream (orange), selected (yellow), and cycle edges (red).',
            placement: 'top',
            before() {
                const bar = document.getElementById('graphStatusBar');
                if (bar && getComputedStyle(bar).display === 'none') {
                    bar.style.display = 'flex';
                    bar.dataset.tourRevealed = 'true';
                }
            },
            after() {
                const bar = document.getElementById('graphStatusBar');
                if (bar && bar.dataset.tourRevealed) {
                    bar.style.display = '';
                    delete bar.dataset.tourRevealed;
                }
            },
        },
        {
            target: '#themeToggle',
            label: 'Theme',
            desc: 'Toggle light and dark mode. Your preference is saved automatically.',
            placement: 'bottom-end',
        },
        {
            target: '#panel-simulate',
            label: 'Refactor Simulator',
            desc: 'Model refactoring before you commit. Remove files or edges to check what breaks, or use Merge/Split to simulate combining two files into one or splitting a large file into parts \u2014 with full impact analysis.',
            placement: 'left',
            before() {
                const tab = document.querySelector('.sidebar-tab[data-panel="panel-simulate"]');
                if (tab) switchTab(tab);
            },
        },
    ];

    let overlayEl = null;
    let isOpen = false;
    let current = 0;

    // ---- Build overlay shell (once per open) ----
    function createOverlay() {
        if (overlayEl) overlayEl.remove();

        overlayEl = document.createElement('div');
        overlayEl.className = 'tour-overlay';
        overlayEl.innerHTML = `
            <svg class="tour-cutout" width="100%" height="100%">
                <defs>
                    <mask id="tour-mask">
                        <rect width="100%" height="100%" fill="white"/>
                        <rect class="tour-spotlight" rx="8" ry="8" fill="black"/>
                    </mask>
                </defs>
                <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#tour-mask)"/>
            </svg>
            <div class="tour-tooltip">
                <div class="tour-tooltip-step"></div>
                <div class="tour-tooltip-label"></div>
                <div class="tour-tooltip-desc"></div>
                <div class="tour-tooltip-footer">
                    <div class="tour-dots"></div>
                    <div class="tour-tooltip-nav">
                        <button class="tour-btn tour-btn-back">Back</button>
                        <button class="tour-btn tour-btn-next tour-btn-primary">Next</button>
                    </div>
                </div>
            </div>
            <button class="tour-skip-btn">Skip tour</button>
        `;

        // Wire events
        overlayEl.querySelector('.tour-btn-back').addEventListener('click', prev);
        overlayEl.querySelector('.tour-btn-next').addEventListener('click', next);
        overlayEl.querySelector('.tour-skip-btn').addEventListener('click', close);
        overlayEl.querySelector('.tour-cutout').addEventListener('click', (e) => {
            // Click on the dark area (not the spotlight hole) closes
            if (e.target.closest('.tour-tooltip')) return;
            close();
        });

        // Build dots
        const dotsWrap = overlayEl.querySelector('.tour-dots');
        steps.forEach((_, i) => {
            const dot = document.createElement('button');
            dot.className = 'tour-dot';
            dot.setAttribute('aria-label', `Step ${i + 1}`);
            dot.addEventListener('click', () => goTo(i));
            dotsWrap.appendChild(dot);
        });

        document.body.appendChild(overlayEl);
    }

    let prevStep = -1;

    // ---- Render current step ----
    function renderStep() {
        // Clean up previous step if it had an after-action
        if (prevStep >= 0 && prevStep !== current && steps[prevStep].after) {
            steps[prevStep].after();
        }
        prevStep = current;

        const step = steps[current];

        // Run optional before-action (e.g. open a panel)
        if (step.before) step.before();

        const target = document.querySelector(step.target);

        // Update text
        overlayEl.querySelector('.tour-tooltip-step').textContent = `${current + 1} of ${steps.length}`;
        overlayEl.querySelector('.tour-tooltip-label').textContent = step.label;
        overlayEl.querySelector('.tour-tooltip-desc').textContent = step.desc;

        // Update buttons
        const backBtn = overlayEl.querySelector('.tour-btn-back');
        const nextBtn = overlayEl.querySelector('.tour-btn-next');
        backBtn.style.visibility = current === 0 ? 'hidden' : 'visible';
        nextBtn.textContent = current === steps.length - 1 ? 'Done' : 'Next';

        // Update dots
        overlayEl.querySelectorAll('.tour-dot').forEach((d, i) => {
            d.classList.toggle('active', i === current);
            d.classList.toggle('visited', i < current);
        });

        // Position spotlight
        const spotlight = overlayEl.querySelector('.tour-spotlight');
        if (target && !isHidden(target)) {
            const r = target.getBoundingClientRect();
            const pad = 6;
            spotlight.setAttribute('x', r.left - pad);
            spotlight.setAttribute('y', r.top - pad);
            spotlight.setAttribute('width', r.width + pad * 2);
            spotlight.setAttribute('height', r.height + pad * 2);
        } else {
            // If element is hidden, center a small spotlight
            spotlight.setAttribute('x', window.innerWidth / 2 - 50);
            spotlight.setAttribute('y', window.innerHeight / 2 - 25);
            spotlight.setAttribute('width', 100);
            spotlight.setAttribute('height', 50);
        }

        // Position tooltip near the target
        positionTooltip(target, step.placement);
    }

    function positionTooltip(target, placement) {
        const tip = overlayEl.querySelector('.tour-tooltip');
        // Reset for measuring
        tip.style.transition = 'none';
        tip.style.opacity = '0';
        tip.style.top = '0';
        tip.style.left = '0';
        tip.style.right = 'auto';

        requestAnimationFrame(() => {
            const tRect = tip.getBoundingClientRect();
            const pad = 14;
            let top, left;

            if (!target || isHidden(target)) {
                // Fallback: center of screen
                top = window.innerHeight / 2 - tRect.height / 2;
                left = window.innerWidth / 2 - tRect.width / 2;
            } else {
                const r = target.getBoundingClientRect();
                switch (placement) {
                    case 'bottom-start':
                        top = r.bottom + pad;
                        left = r.left;
                        break;
                    case 'bottom':
                        top = r.bottom + pad;
                        left = r.left + r.width / 2 - tRect.width / 2;
                        break;
                    case 'bottom-end':
                        top = r.bottom + pad;
                        left = r.right - tRect.width;
                        break;
                    case 'top':
                        top = r.top - tRect.height - pad;
                        left = r.left + r.width / 2 - tRect.width / 2;
                        break;
                    case 'left':
                        top = r.top + r.height / 2 - tRect.height / 2;
                        left = r.left - tRect.width - pad;
                        break;
                    case 'right':
                        top = r.top + r.height / 2 - tRect.height / 2;
                        left = r.right + pad;
                        break;
                    case 'center':
                        top = r.top + r.height / 2 - tRect.height / 2;
                        left = r.left + r.width / 2 - tRect.width / 2;
                        break;
                    default:
                        top = r.bottom + pad;
                        left = r.left;
                }
            }

            // Clamp within viewport
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            left = Math.max(12, Math.min(left, vw - tRect.width - 12));
            top = Math.max(12, Math.min(top, vh - tRect.height - 12));

            tip.style.top = top + 'px';
            tip.style.left = left + 'px';
            tip.style.transition = '';
            tip.style.opacity = '1';
        });
    }

    function isHidden(el) {
        const s = getComputedStyle(el);
        return s.display === 'none' || s.visibility === 'hidden' || el.offsetParent === null;
    }

    // ---- Navigation ----
    function next() {
        if (current < steps.length - 1) {
            current++;
            renderStep();
        } else {
            close();
        }
    }

    function prev() {
        if (current > 0) {
            current--;
            renderStep();
        }
    }

    function goTo(idx) {
        current = Math.max(0, Math.min(idx, steps.length - 1));
        renderStep();
    }

    // ---- Public API ----
    function open() {
        if (isOpen) return;
        isOpen = true;
        current = 0;
        createOverlay();
        requestAnimationFrame(() => {
            overlayEl.classList.add('open');
            renderStep();
        });
        document.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', onResize);
    }

    function close() {
        if (!isOpen) return;
        // Clean up current step's after-action
        if (prevStep >= 0 && steps[prevStep].after) steps[prevStep].after();
        prevStep = -1;
        isOpen = false;
        overlayEl.classList.add('closing');
        setTimeout(() => {
            if (overlayEl) { overlayEl.remove(); overlayEl = null; }
        }, 250);
        document.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('resize', onResize);
    }

    function toggle() {
        isOpen ? close() : open();
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); next(); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); prev(); }
    }

    let resizeTimer;
    function onResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (isOpen) renderStep(); }, 100);
    }

    return { open, close, toggle };
})();
