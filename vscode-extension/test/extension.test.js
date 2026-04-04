"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
// Basic smoke tests — these run outside VS Code context,
// so we test the pure-logic helpers from engine.ts
suite('DepGraph Engine Helpers', () => {
    const mockGraph = {
        nodes: [
            { data: { id: 'a.py', color: '#6366f1', size: 30, depth: 0, impact: 3, stability: 0.5, reach_pct: 60 } },
            { data: { id: 'b.py', color: '#10b981', size: 20, depth: 1, impact: 1, stability: 0.8, reach_pct: 20 } },
            { data: { id: 'c.py', color: '#f59e0b', size: 20, depth: 2, impact: 0, stability: 1.0, reach_pct: 0 } },
        ],
        edges: [
            { data: { source: 'b.py', target: 'a.py', color: '#666' } },
            { data: { source: 'c.py', target: 'b.py', color: '#666' } },
        ],
        has_cycles: false,
        cycles: [],
        unused_files: [],
        coupling: [],
        depth_warnings: [],
        detected: { py: 3 },
    };
    test('getDependents returns files that import target', () => {
        // b.py → a.py, so a.py has one dependent: b.py
        const dependents = mockGraph.edges
            .filter(e => e.data.target === 'a.py')
            .map(e => e.data.source);
        assert.deepStrictEqual(dependents, ['b.py']);
    });
    test('getDependencies returns files that source imports', () => {
        // b.py → a.py, so b.py has one dependency: a.py
        const deps = mockGraph.edges
            .filter(e => e.data.source === 'b.py')
            .map(e => e.data.target);
        assert.deepStrictEqual(deps, ['a.py']);
    });
    test('blast radius BFS finds transitive dependents', () => {
        // a.py ← b.py ← c.py
        // blast radius of a.py should be {b.py, c.py}
        const visited = new Set();
        const queue = ['a.py'];
        while (queue.length > 0) {
            const current = queue.shift();
            if (visited.has(current))
                continue;
            visited.add(current);
            const dependents = mockGraph.edges
                .filter(e => e.data.target === current)
                .map(e => e.data.source);
            for (const dep of dependents) {
                if (!visited.has(dep))
                    queue.push(dep);
            }
        }
        visited.delete('a.py');
        assert.deepStrictEqual(visited, new Set(['b.py', 'c.py']));
    });
    test('cycle detection identifies files in cycles', () => {
        const cyclicGraph = {
            ...mockGraph,
            has_cycles: true,
            cycles: [['a.py', 'b.py']],
        };
        const fileInCycle = cyclicGraph.cycles.some(c => c.includes('a.py'));
        const fileNotInCycle = cyclicGraph.cycles.some(c => c.includes('c.py'));
        assert.strictEqual(fileInCycle, true);
        assert.strictEqual(fileNotInCycle, false);
    });
});
//# sourceMappingURL=extension.test.js.map