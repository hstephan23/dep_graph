import * as vscode from 'vscode';
import {
  getGraph, getDependents, getDependencies, getBlastRadius,
  toRelativePath,
} from './engine';
import { GraphWebviewProvider } from './webview';
import { getWorkspaceRoot } from './config';
import * as path from 'path';

// ── Helper: resolve current file to a graph node ID ─────────────

function currentFileId(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('DepGraph: No active editor');
    return undefined;
  }
  const rel = toRelativePath(editor.document.uri.fsPath);
  if (!rel) {
    vscode.window.showWarningMessage('DepGraph: File is outside the workspace');
    return undefined;
  }
  return rel;
}

// ── Command: Show Graph ─────────────────────────────────────────

export async function showGraph(extensionUri: vscode.Uri): Promise<void> {
  const panel = GraphWebviewProvider.create(extensionUri);
  await panel.loadGraph();
}

// ── Command: Find Cycles ────────────────────────────────────────

export async function findCycles(extensionUri: vscode.Uri): Promise<void> {
  const graph = await getGraph();

  if (!graph.has_cycles || graph.cycles.length === 0) {
    vscode.window.showInformationMessage('DepGraph: No dependency cycles found!');
    return;
  }

  // Show quick pick with cycles
  const items = graph.cycles.map((cycle, i) => ({
    label: `Cycle ${i + 1}`,
    description: `${cycle.length} files`,
    detail: cycle.join(' → ') + ' → ' + cycle[0],
    cycle,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: `${graph.cycles.length} Dependency Cycle(s) Found`,
    placeHolder: 'Select a cycle to highlight in the graph',
  });

  if (picked) {
    const panel = GraphWebviewProvider.create(extensionUri);
    await panel.loadGraph();
    panel.highlightNodes(picked.cycle, 'Cycle');
  }
}

// ── Command: Show Dependents ────────────────────────────────────

export async function showDependents(extensionUri: vscode.Uri): Promise<void> {
  const fileId = currentFileId();
  if (!fileId) { return; }

  const graph = await getGraph();
  const dependents = getDependents(graph, fileId);

  if (dependents.length === 0) {
    vscode.window.showInformationMessage(`DepGraph: No files import ${fileId}`);
    return;
  }

  const root = getWorkspaceRoot();
  const items = dependents.map(d => ({
    label: d,
    description: '',
    fileId: d,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: `${dependents.length} file(s) import ${fileId}`,
    placeHolder: 'Select to open',
  });

  if (picked && root) {
    const uri = vscode.Uri.file(path.join(root, picked.fileId));
    vscode.window.showTextDocument(uri);
  }
}

// ── Command: Show Dependencies ──────────────────────────────────

export async function showDependencies(extensionUri: vscode.Uri): Promise<void> {
  const fileId = currentFileId();
  if (!fileId) { return; }

  const graph = await getGraph();
  const deps = getDependencies(graph, fileId);

  if (deps.length === 0) {
    vscode.window.showInformationMessage(`DepGraph: ${fileId} has no imports`);
    return;
  }

  const root = getWorkspaceRoot();
  const items = deps.map(d => ({
    label: d,
    description: '',
    fileId: d,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: `${fileId} imports ${deps.length} file(s)`,
    placeHolder: 'Select to open',
  });

  if (picked && root) {
    const uri = vscode.Uri.file(path.join(root, picked.fileId));
    vscode.window.showTextDocument(uri);
  }
}

// ── Command: Blast Radius ───────────────────────────────────────

export async function blastRadius(extensionUri: vscode.Uri): Promise<void> {
  const fileId = currentFileId();
  if (!fileId) { return; }

  const graph = await getGraph();
  const radius = getBlastRadius(graph, fileId);

  if (radius.size === 0) {
    vscode.window.showInformationMessage(`DepGraph: No files transitively depend on ${fileId}`);
    return;
  }

  const panel = GraphWebviewProvider.create(extensionUri);
  await panel.loadGraph();
  panel.highlightNodes([fileId, ...Array.from(radius)], `Blast radius of ${fileId}`);

  vscode.window.showInformationMessage(
    `DepGraph: ${radius.size} file(s) would be affected by changes to ${fileId}`,
  );
}

// ── Command: Export JSON ────────────────────────────────────────

export async function exportJSON(): Promise<void> {
  const graph = await getGraph();
  const uri = await vscode.window.showSaveDialog({
    filters: { 'JSON': ['json'] },
    defaultUri: vscode.Uri.file('depgraph.json'),
  });
  if (uri) {
    const content = Buffer.from(JSON.stringify(graph, null, 2), 'utf-8');
    await vscode.workspace.fs.writeFile(uri, content);
    vscode.window.showInformationMessage('DepGraph: Exported as JSON');
  }
}

// ── Command: Export DOT ─────────────────────────────────────────

export async function exportDOT(): Promise<void> {
  const graph = await getGraph();
  let dot = 'digraph depgraph {\n  rankdir=LR;\n  node [shape=box, style=filled];\n\n';
  for (const node of graph.nodes) {
    dot += `  "${node.data.id}" [fillcolor="${node.data.color}"];\n`;
  }
  dot += '\n';
  for (const edge of graph.edges) {
    const style = edge.classes === 'cycle' ? ' [style=dashed, color=red]' : '';
    dot += `  "${edge.data.source}" -> "${edge.data.target}"${style};\n`;
  }
  dot += '}\n';

  const uri = await vscode.window.showSaveDialog({
    filters: { 'DOT': ['dot', 'gv'] },
    defaultUri: vscode.Uri.file('depgraph.dot'),
  });
  if (uri) {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(dot, 'utf-8'));
    vscode.window.showInformationMessage('DepGraph: Exported as DOT');
  }
}

// ── Command: Export Mermaid ─────────────────────────────────────

export async function exportMermaid(): Promise<void> {
  const graph = await getGraph();
  let mmd = 'flowchart LR\n';
  for (const node of graph.nodes) {
    const safe = node.data.id.replace(/[^a-zA-Z0-9_]/g, '_');
    mmd += `  ${safe}["${node.data.id}"]\n`;
  }
  mmd += '\n';
  for (const edge of graph.edges) {
    const src = edge.data.source.replace(/[^a-zA-Z0-9_]/g, '_');
    const tgt = edge.data.target.replace(/[^a-zA-Z0-9_]/g, '_');
    const arrow = edge.classes === 'cycle' ? '-.->' : '-->';
    mmd += `  ${src} ${arrow} ${tgt}\n`;
  }

  const uri = await vscode.window.showSaveDialog({
    filters: { 'Mermaid': ['mmd', 'mermaid'] },
    defaultUri: vscode.Uri.file('depgraph.mmd'),
  });
  if (uri) {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(mmd, 'utf-8'));
    vscode.window.showInformationMessage('DepGraph: Exported as Mermaid');
  }
}
