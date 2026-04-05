/**
 * Tests for analysis.js — depth warnings and insights computation.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'vm';
import { loadModules, setupDOM, makeGraphData } from './helpers.js';

/**
 * Set the module-scoped `currentGraphData` variable.
 * Because state.js uses `let`, it doesn't land on globalThis,
 * but vm.runInThisContext can still access it in the same scope.
 */
function setGraphData(data) {
  // Stash on globalThis so the inline script can grab it
  globalThis.__testGraphData = data;
  vm.runInThisContext('currentGraphData = globalThis.__testGraphData');
}

before(() => {
  setupDOM();
  loadModules('state.js', 'analysis.js', 'exports.js');
});

// ----------------------------------------------------------------
// _computeClientDepthWarnings
// ----------------------------------------------------------------
describe('_computeClientDepthWarnings', () => {
  it('returns empty array for null/empty data', () => {
    assert.deepEqual(globalThis._computeClientDepthWarnings(null), []);
    assert.deepEqual(globalThis._computeClientDepthWarnings({ nodes: [] }), []);
  });

  it('returns no warnings when all nodes are shallow and low-impact', () => {
    const data = makeGraphData({
      nodes: [
        { id: 'a.js', depth: 1, impact: 1 },
        { id: 'b.js', depth: 2, impact: 1 },
        // Enough nodes so impact/total stays below 30%
        ...Array.from({ length: 8 }, (_, i) => ({ id: `pad${i}.js`, depth: 0, impact: 0 })),
      ],
    });
    assert.deepEqual(globalThis._computeClientDepthWarnings(data), []);
  });

  it('flags deep dependency chains as warnings', () => {
    const data = makeGraphData({
      nodes: [
        { id: 'deep.js', depth: 6, impact: 0 },
        { id: 'shallow.js', depth: 2, impact: 0 },
      ],
    });
    const warnings = globalThis._computeClientDepthWarnings(data);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].file, 'deep.js');
    assert.equal(warnings[0].severity, 'warning');
    assert.ok(warnings[0].reasons.some((r) => r.includes('6 levels deep')));
  });

  it('flags critically deep chains', () => {
    const data = makeGraphData({
      nodes: [{ id: 'verydeep.js', depth: 10, impact: 0 }],
    });
    const warnings = globalThis._computeClientDepthWarnings(data);
    assert.equal(warnings[0].severity, 'critical');
  });

  it('flags high reach percentage as critical', () => {
    const data = makeGraphData({
      nodes: [
        { id: 'hub.js', depth: 0, impact: 2 },
        { id: 'a.js', depth: 0, impact: 0 },
        { id: 'b.js', depth: 0, impact: 0 },
        { id: 'c.js', depth: 0, impact: 0 },
      ],
    });
    const warnings = globalThis._computeClientDepthWarnings(data);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].file, 'hub.js');
    assert.equal(warnings[0].severity, 'critical');
  });

  it('sorts critical before warning', () => {
    const data = makeGraphData({
      nodes: [
        { id: 'warn.js', depth: 6, impact: 0 },
        { id: 'crit.js', depth: 10, impact: 0 },
      ],
    });
    const warnings = globalThis._computeClientDepthWarnings(data);
    assert.equal(warnings[0].file, 'crit.js');
    assert.equal(warnings[1].file, 'warn.js');
  });
});

// ----------------------------------------------------------------
// computeInsights
// ----------------------------------------------------------------
describe('computeInsights', () => {
  it('computes overview stats correctly', () => {
    setGraphData(makeGraphData({
      nodes: ['src/a.js', 'src/b.js', 'lib/c.js'],
      edges: [['src/a.js', 'src/b.js'], ['src/b.js', 'lib/c.js']],
    }));
    const ins = globalThis.computeInsights();
    assert.equal(ins.overview.files, 3);
    assert.equal(ins.overview.edges, 2);
    assert.equal(ins.overview.directories, 2);
  });

  it('detects unused files (zero inbound)', () => {
    setGraphData(makeGraphData({
      nodes: ['a.js', 'b.js', 'c.js'],
      edges: [['a.js', 'b.js']],
    }));
    const ins = globalThis.computeInsights();
    assert.ok(ins.unusedFiles.includes('a.js'));
    assert.ok(ins.unusedFiles.includes('c.js'));
    assert.ok(!ins.unusedFiles.includes('b.js'));
  });

  it('detects cycles from graph data', () => {
    setGraphData(makeGraphData({
      nodes: ['a.js', 'b.js'],
      edges: [['a.js', 'b.js'], ['b.js', 'a.js']],
      cycles: [['a.js', 'b.js']],
    }));
    const ins = globalThis.computeInsights();
    assert.equal(ins.cycles.count, 1);
    assert.ok(ins.cycles.files.includes('a.js'));
    assert.ok(ins.cycles.files.includes('b.js'));
  });

  it('penalizes score for cycles', () => {
    // Use enough nodes that cycles are the distinguishing factor
    const nodes = ['a.js', 'b.js', 'c.js', 'd.js', 'e.js'];
    const baseEdges = [['a.js', 'b.js'], ['b.js', 'c.js'], ['c.js', 'd.js'], ['d.js', 'e.js']];

    setGraphData(makeGraphData({ nodes, edges: baseEdges }));
    const cleanScore = globalThis.computeInsights().score;

    setGraphData(makeGraphData({
      nodes,
      edges: [...baseEdges, ['e.js', 'a.js']],
      cycles: [['a.js', 'b.js', 'c.js', 'd.js', 'e.js']],
    }));
    const cyclicScore = globalThis.computeInsights().score;

    assert.ok(cyclicScore < cleanScore, `cyclic ${cyclicScore} should be < clean ${cleanScore}`);
  });

  it('health score stays in 0-100 range', () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      id: `f${i}.js`, depth: 10, impact: 15, stability: 0.9,
    }));
    const edges = [];
    for (let i = 0; i < 19; i++) {
      edges.push([`f${i}.js`, `f${i + 1}.js`]);
      edges.push([`f${i + 1}.js`, `f${i}.js`]);
    }
    setGraphData(makeGraphData({
      nodes, edges,
      cycles: [nodes.map((n) => n.id)],
      coupling: [{ dir1: 'a', dir2: 'b', cross_edges: 10, score: 0.8 }],
    }));
    const ins = globalThis.computeInsights();
    assert.ok(ins.score >= 0);
    assert.ok(ins.score <= 100);
  });

  it('identifies hub files (high in + high out)', () => {
    const nodes = ['hub.js', ...Array.from({ length: 10 }, (_, i) => `dep${i}.js`)];
    const edges = [];
    for (let i = 0; i < 6; i++) edges.push([`dep${i}.js`, 'hub.js']);
    for (let i = 4; i < 10; i++) edges.push(['hub.js', `dep${i}.js`]);

    setGraphData(makeGraphData({ nodes, edges }));
    const ins = globalThis.computeInsights();
    assert.ok(ins.hubs.some((h) => h.id === 'hub.js'));
  });

  it('finds deep dependency chains', () => {
    setGraphData(makeGraphData({
      nodes: [
        { id: 'deep.js', depth: 8 },
        { id: 'shallow.js', depth: 2 },
      ],
      edges: [],
    }));
    const ins = globalThis.computeInsights();
    assert.ok(ins.deepFiles.some((f) => f.id === 'deep.js'));
    assert.ok(!ins.deepFiles.some((f) => f.id === 'shallow.js'));
  });
});
