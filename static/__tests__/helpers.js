/**
 * Test helper: loads vanilla JS source files into global scope using Node's vm module.
 *
 * Because the production code uses plain globals (no ES modules), we compile each
 * file and run it in a context that shares our globalThis, so every `function foo()`
 * and `let bar` becomes available globally — just like browser <script> tags.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import { JSDOM } from './jsdom-shim.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC = join(__dirname, '..');

/**
 * Set up a minimal DOM environment so modules that touch the DOM on load don't crash.
 * Must be called once before loadModules().
 */
export function setupDOM() {
  const dom = new JSDOM();
  globalThis.document = dom.document;
  globalThis.window = dom.window;
  globalThis.HTMLElement = dom.window.HTMLElement || class HTMLElement {};
  globalThis.getComputedStyle = () => ({
    getPropertyValue: () => '#1a1a2e',
  });
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  globalThis.fetch = () => Promise.resolve({ ok: false });
  globalThis.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };
  globalThis.Blob = class Blob { constructor(parts, opts) { this.parts = parts; this.opts = opts; } };
  globalThis.Image = class Image {
    set src(v) { if (this.onload) setTimeout(() => this.onload(), 0); }
  };
}

/**
 * Load one or more JS files from static/ into the global scope.
 * Files are evaluated in order so put dependencies first.
 *
 * @param {...string} filenames - file names relative to static/
 */
export function loadModules(...filenames) {
  for (const name of filenames) {
    const code = readFileSync(join(STATIC, name), 'utf-8');
    // Run in the current global context
    vm.runInThisContext(code, { filename: name });
  }
}

/**
 * Build a realistic graph data object for testing.
 */
export function makeGraphData({ nodes = [], edges = [], cycles = [], coupling = [] } = {}) {
  return {
    nodes: nodes.map((n) =>
      typeof n === 'string'
        ? { data: { id: n, depth: 0, impact: 0, stability: '0.5', color: '#ccc' } }
        : {
            data: {
              id: n.id,
              depth: n.depth ?? 0,
              impact: n.impact ?? 0,
              stability: String(n.stability ?? 0.5),
              color: n.color ?? '#ccc',
            },
          }
    ),
    edges: edges.map(([source, target, cls]) => ({
      data: { source, target, color: '#94a3b8' },
      ...(cls ? { classes: cls } : {}),
    })),
    cycles,
    coupling,
  };
}
