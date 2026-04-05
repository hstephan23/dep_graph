/**
 * Tests for exports.js — DOT export, Mermaid export, and insights markdown.
 *
 * exportDOT and exportMermaid build strings then trigger downloads.
 * We test the string-building logic by extracting the core generation into
 * testable wrappers, and also test buildInsightsMarkdown directly.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'vm';
import { loadModules, setupDOM, makeGraphData } from './helpers.js';

function setGraphData(data) {
  globalThis.__testGraphData = data;
  vm.runInThisContext('currentGraphData = globalThis.__testGraphData');
}

before(() => {
  setupDOM();
  loadModules('state.js', 'exports.js');
});

// ----------------------------------------------------------------
// exportDOT — we inject a capture hook via the download <a> element
// ----------------------------------------------------------------
describe('exportDOT', () => {
  function captureDOT(graphData) {
    setGraphData(graphData);
    let captured = null;

    // The function creates an <a> element, sets .href to a data URI, calls .click(), then .remove().
    // Our shim's createElement returns a plain object. We intercept href to capture the output.
    const origCreate = globalThis.document.createElement;
    globalThis.document.createElement = (tag) => {
      if (tag === 'a') {
        return {
          set href(v) { captured = decodeURIComponent(v.replace(/^data:[^,]+,/, '')); },
          get href() { return ''; },
          download: '',
          click() {},
          remove() {},
        };
      }
      return origCreate.call(globalThis.document, tag);
    };

    globalThis.exportDOT();
    globalThis.document.createElement = origCreate;
    return captured;
  }

  it('generates valid DOT with nodes and edges', () => {
    const dot = captureDOT(makeGraphData({
      nodes: ['a.js', 'b.js'],
      edges: [['a.js', 'b.js']],
    }));
    assert.ok(dot !== null, 'DOT output should be captured');
    assert.ok(dot.includes('digraph DependencyGraph'));
    assert.ok(dot.includes('"a.js"'));
    assert.ok(dot.includes('"b.js"'));
    assert.ok(dot.includes('"a.js" -> "b.js"'));
  });

  it('marks cycle edges in red', () => {
    const dot = captureDOT(makeGraphData({
      nodes: ['a.js', 'b.js'],
      edges: [['a.js', 'b.js', 'cycle']],
    }));
    assert.ok(dot.includes('color="red"'));
  });

  it('applies node colors from data', () => {
    const dot = captureDOT(makeGraphData({
      nodes: [{ id: 'a.js', color: '#ff0000' }],
      edges: [],
    }));
    assert.ok(dot.includes('fillcolor="#ff0000"'));
  });

  it('does not throw when no graph data', () => {
    setGraphData(null);
    globalThis.exportDOT(); // should not throw
  });
});

// ----------------------------------------------------------------
// exportMermaid — capture via same approach
// ----------------------------------------------------------------
describe('exportMermaid', () => {
  function captureMermaid(graphData) {
    setGraphData(graphData);
    let captured = null;

    const origCreate = globalThis.document.createElement;
    globalThis.document.createElement = (tag) => {
      if (tag === 'a') {
        return {
          set href(v) {
            if (typeof v === 'string' && v.startsWith('data:')) {
              captured = decodeURIComponent(v.replace(/^data:[^,]+,/, ''));
            }
          },
          get href() { return ''; },
          download: '',
          click() {},
          remove() {},
        };
      }
      return origCreate.call(globalThis.document, tag);
    };

    globalThis.exportMermaid();
    globalThis.document.createElement = origCreate;
    return captured;
  }

  it('generates valid Mermaid diagram', () => {
    const mmd = captureMermaid(makeGraphData({
      nodes: ['a.js', 'b.js'],
      edges: [['a.js', 'b.js']],
    }));
    assert.ok(mmd !== null, 'Mermaid output should be captured');
    assert.ok(mmd.includes('graph TD'));
    assert.ok(mmd.includes('-->'));
  });

  it('uses dotted arrows for cycle edges', () => {
    const mmd = captureMermaid(makeGraphData({
      nodes: ['a.js', 'b.js'],
      edges: [['a.js', 'b.js', 'cycle']],
    }));
    assert.ok(mmd.includes('cycle'));
    assert.ok(mmd.includes('-.'));
  });

  it('groups files in the same directory into subgraphs', () => {
    const mmd = captureMermaid(makeGraphData({
      nodes: ['src/a.js', 'src/b.js', 'lib/c.js'],
      edges: [['src/a.js', 'src/b.js']],
    }));
    assert.ok(mmd.includes('subgraph'));
    assert.ok(mmd.includes('src'));
  });

  it('does not create subgraphs for single-file directories', () => {
    const mmd = captureMermaid(makeGraphData({
      nodes: ['src/a.js', 'lib/c.js'],
      edges: [['src/a.js', 'lib/c.js']],
    }));
    // Neither dir has >1 file, so no subgraphs
    assert.ok(!mmd.includes('subgraph'));
  });
});

// ----------------------------------------------------------------
// buildInsightsMarkdown
// ----------------------------------------------------------------
describe('buildInsightsMarkdown', () => {
  const baseInsights = {
    score: 100,
    overview: { files: 2, edges: 1, directories: 1, density: 0.5 },
    cycles: { count: 0, files: [], chains: [] },
    godFiles: [],
    unusedFiles: [],
    highFanOut: [],
    hubs: [],
    deepFiles: [],
    highImpact: [],
    unstableCore: [],
    coupling: [],
  };

  it('includes health score', () => {
    const md = globalThis.buildInsightsMarkdown({
      ...baseInsights,
      score: 85,
      overview: { files: 10, edges: 15, directories: 3, density: 1.5 },
    });
    assert.ok(md.includes('Health Score: 85/100'));
    assert.ok(md.includes('| Files | 10 |'));
    assert.ok(md.includes('| Dependencies | 15 |'));
  });

  it('includes cycles section when present', () => {
    const md = globalThis.buildInsightsMarkdown({
      ...baseInsights,
      score: 60,
      cycles: { count: 1, files: ['a.js', 'b.js'], chains: [['a.js', 'b.js']] },
    });
    assert.ok(md.includes('## Circular Dependencies'));
    assert.ok(md.includes('`a.js`'));
    assert.ok(md.includes('`b.js`'));
  });

  it('includes god files section', () => {
    const md = globalThis.buildInsightsMarkdown({
      ...baseInsights,
      godFiles: [{ id: 'utils.js', inbound: 20 }],
    });
    assert.ok(md.includes('## God Files'));
    assert.ok(md.includes('`utils.js`'));
    assert.ok(md.includes('20 inbound refs'));
  });

  it('includes hub files section', () => {
    const md = globalThis.buildInsightsMarkdown({
      ...baseInsights,
      hubs: [{ id: 'hub.js', inbound: 8, outbound: 7 }],
    });
    assert.ok(md.includes('## Hub Files'));
    assert.ok(md.includes('in:8 out:7'));
  });

  it('includes unused files section', () => {
    const md = globalThis.buildInsightsMarkdown({
      ...baseInsights,
      unusedFiles: ['orphan.js'],
    });
    assert.ok(md.includes('## Unused Files'));
    assert.ok(md.includes('`orphan.js`'));
  });

  it('omits empty sections', () => {
    const md = globalThis.buildInsightsMarkdown(baseInsights);
    assert.ok(!md.includes('## Circular Dependencies'));
    assert.ok(!md.includes('## God Files'));
    assert.ok(!md.includes('## Hub Files'));
    assert.ok(!md.includes('## Unused Files'));
  });

  it('ends with DepGraph signature', () => {
    const md = globalThis.buildInsightsMarkdown(baseInsights);
    assert.ok(md.includes('Generated by DepGraph'));
  });

  it('includes coupling section', () => {
    const md = globalThis.buildInsightsMarkdown({
      ...baseInsights,
      coupling: [{ dir1: 'src', dir2: 'lib', cross_edges: 5, score: 0.4 }],
    });
    assert.ok(md.includes('Directory Coupling'));
    assert.ok(md.includes('`src`'));
    assert.ok(md.includes('`lib`'));
  });

  it('includes deep files section', () => {
    const md = globalThis.buildInsightsMarkdown({
      ...baseInsights,
      deepFiles: [{ id: 'deep.js', depth: 9 }],
    });
    assert.ok(md.includes('## Deep Dependency Chains'));
    assert.ok(md.includes('depth 9'));
  });
});
