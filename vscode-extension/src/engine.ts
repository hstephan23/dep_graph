import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { getConfig, getWorkspaceRoot } from './config';

// ── Locate the DepGraph Python source directory ───────────────────
// The extension lives at <depgraph-root>/vscode-extension, so the
// Python source (cli.py, graph.py, parsers.py) is one level up.
let _depgraphRoot: string | undefined;

export function setDepgraphRoot(extensionPath: string): void {
  _depgraphRoot = path.resolve(extensionPath, '..');
}

function getCliPath(): string {
  if (!_depgraphRoot) {
    throw new Error('DepGraph root not set — call setDepgraphRoot() first');
  }
  return path.join(_depgraphRoot, 'cli.py');
}

// ── Types matching the CLI's --json output ──────────────────────────

export interface GraphNode {
  data: {
    id: string;
    color: string;
    size: number;
    depth: number;
    impact: number;
    stability: number;
    reach_pct: number;
    in_degree: number;
    out_degree: number;
    language: string | null;
    in_cycle: boolean;
    risk: 'critical' | 'high' | 'warning' | 'normal' | 'entry' | 'system';
    risk_color: string;
    risk_label: string;
    node_size: number;
    dir_color: string;
    [key: string]: unknown;
  };
}

export interface GraphEdge {
  data: {
    source: string;
    target: string;
    color: string;
    weight: number; // 1-5, importance of this edge
  };
  classes?: string; // "cycle" when part of a cycle
}

export interface CouplingEntry {
  dir1: string;
  dir2: string;
  cross_edges: number;
  score: number;
}

export interface DepthWarning {
  file: string;
  severity: 'critical' | 'warning';
  depth: number;
  impact: number;
  reach_pct: number;
  reasons: string[];
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  has_cycles: boolean;
  cycles: string[][];
  unused_files: string[];
  coupling: CouplingEntry[];
  depth_warnings: DepthWarning[];
}

// ── Server management ───────────────────────────────────────────────

let serverProcess: ChildProcess | null = null;
let serverPort: number = 0;
let serverReady: boolean = false;

function findFreePort(): number {
  // Pick a random high port; in practice the OS will assign one
  return 17200 + Math.floor(Math.random() * 1000);
}

export async function startServer(): Promise<number> {
  if (serverProcess && serverReady) {
    return serverPort;
  }

  const config = getConfig();
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error('No workspace folder open');
  }

  serverPort = findFreePort();

  return new Promise<number>((resolve, reject) => {
    const cliPath = getCliPath();
    const proc = spawn(config.pythonPath, [
      cliPath,
      root,
      '--serve',
      '--port', String(serverPort),
    ], {
      cwd: _depgraphRoot,
      env: { ...process.env, DEPGRAPH_BASE_DIR: root },
    });

    serverProcess = proc;

    const timeout = setTimeout(() => {
      reject(new Error('DepGraph server failed to start within 15 seconds'));
    }, 15_000);

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      // Flask prints "Running on http://..." when ready
      if (text.includes('Running on') || text.includes('Serving Flask')) {
        clearTimeout(timeout);
        serverReady = true;
        resolve(serverPort);
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      // Flask sometimes logs to stderr
      if (text.includes('Running on') || text.includes('Serving Flask')) {
        clearTimeout(timeout);
        serverReady = true;
        resolve(serverPort);
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      serverProcess = null;
      serverReady = false;
      reject(new Error(`Failed to start depgraph: ${err.message}`));
    });

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      serverProcess = null;
      serverReady = false;
      if (!serverReady) {
        reject(new Error(`depgraph exited with code ${code}`));
      }
    });
  });
}

export function stopServer(): void {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
    serverReady = false;
  }
}

export function getServerUrl(): string {
  return `http://127.0.0.1:${serverPort}`;
}

// ── CLI-based graph fetching (no server needed) ─────────────────────

export async function fetchGraphJSON(directory?: string): Promise<GraphData> {
  const config = getConfig();
  const root = directory ?? getWorkspaceRoot();
  if (!root) {
    throw new Error('No workspace folder open');
  }

  const cliPath = getCliPath();
  const args = [cliPath, root, '--json'];
  if (config.language !== 'auto') {
    args.push('--lang', config.language);
  }
  if (config.hideExternal) {
    args.push('--hide-external');
  }
  if (config.hideIsolated) {
    args.push('--hide-isolated');
  }

  return new Promise<GraphData>((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn(config.pythonPath, args, {
      cwd: _depgraphRoot,
      env: { ...process.env },
    });

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to run depgraph CLI: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`depgraph exited with code ${code}: ${stderr}`));
        return;
      }
      try {
        const data = JSON.parse(stdout) as GraphData;
        resolve(data);
      } catch {
        reject(new Error(`Failed to parse depgraph output: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

// ── Convenience helpers ─────────────────────────────────────────────

/** Cached graph data, refreshed on demand or file change */
let cachedGraph: GraphData | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5_000;

const graphChangedEmitter = new vscode.EventEmitter<GraphData>();
export const onGraphChanged = graphChangedEmitter.event;

export async function getGraph(forceRefresh = false): Promise<GraphData> {
  const now = Date.now();
  if (!forceRefresh && cachedGraph && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedGraph;
  }

  cachedGraph = await fetchGraphJSON();
  cacheTimestamp = now;
  graphChangedEmitter.fire(cachedGraph);
  return cachedGraph;
}

export function getCachedGraph(): GraphData | null {
  return cachedGraph;
}

/** Get all files that import the given file */
export function getDependents(graph: GraphData, fileId: string): string[] {
  return graph.edges
    .filter(e => e.data.target === fileId)
    .map(e => e.data.source);
}

/** Get all files that the given file imports */
export function getDependencies(graph: GraphData, fileId: string): string[] {
  return graph.edges
    .filter(e => e.data.source === fileId)
    .map(e => e.data.target);
}

/** BFS to find all transitive dependents (blast radius) */
export function getBlastRadius(graph: GraphData, fileId: string): Set<string> {
  const visited = new Set<string>();
  const queue = [fileId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) { continue; }
    visited.add(current);
    const dependents = getDependents(graph, current);
    for (const dep of dependents) {
      if (!visited.has(dep)) {
        queue.push(dep);
      }
    }
  }

  visited.delete(fileId); // don't include the file itself
  return visited;
}

/** Get the node data for a file */
export function getNodeData(graph: GraphData, fileId: string): GraphNode | undefined {
  return graph.nodes.find(n => n.data.id === fileId);
}

/** Fetch git churn data for the workspace */
export async function getChurn(): Promise<any> {
  const config = getConfig();
  const root = getWorkspaceRoot();
  if (!root) {
    return { files: {}, is_git: false, period: '' };
  }

  const churnScript = path.join(_depgraphRoot!, 'churn.py');
  // Run: python -c "import json; from churn import get_churn; print(json.dumps(get_churn('ROOT')))"
  const code = `import json, sys; sys.path.insert(0, ${JSON.stringify(_depgraphRoot!)}); from churn import get_churn; print(json.dumps(get_churn(${JSON.stringify(root)})))`;

  return new Promise<any>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(config.pythonPath, ['-c', code], {
      cwd: root,
      env: { ...process.env },
    });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (exitCode) => {
      if (exitCode !== 0) {
        console.warn('[DepGraph] churn failed:', stderr);
        resolve({ files: {}, is_git: false, period: '' });
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        console.warn('[DepGraph] churn parse error:', e);
        resolve({ files: {}, is_git: false, period: '' });
      }
    });
    proc.on('error', (err) => {
      console.warn('[DepGraph] churn spawn error:', err);
      resolve({ files: {}, is_git: false, period: '' });
    });
  });
}

/** Fetch churn data from a remote git repo URL */
export async function getChurnFromRemote(repoUrl: string): Promise<any> {
  const config = getConfig();
  const code = `import json, sys; sys.path.insert(0, ${JSON.stringify(_depgraphRoot!)}); from churn import get_churn_from_remote; print(json.dumps(get_churn_from_remote(${JSON.stringify(repoUrl)})))`;

  return new Promise<any>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(config.pythonPath, ['-c', code], {
      env: { ...process.env },
    });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (exitCode) => {
      if (exitCode !== 0) {
        console.warn('[DepGraph] remote churn failed:', stderr);
        resolve({ files: {}, is_git: false, period: '', error: 'Failed to fetch remote churn data' });
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        resolve({ files: {}, is_git: false, period: '', error: 'Parse error' });
      }
    });
    proc.on('error', (err) => {
      resolve({ files: {}, is_git: false, period: '', error: String(err) });
    });
  });
}

/** Convert an absolute path to a workspace-relative path (matching node IDs) */
export function toRelativePath(absolutePath: string): string | undefined {
  const root = getWorkspaceRoot();
  if (!root || !absolutePath.startsWith(root)) { return undefined; }
  let rel = absolutePath.slice(root.length);
  if (rel.startsWith('/') || rel.startsWith('\\')) {
    rel = rel.slice(1);
  }
  return rel;
}
