import * as vscode from 'vscode';

export interface DepGraphConfig {
  pythonPath: string;
  language: string;
  hideExternal: boolean;
  hideIsolated: boolean;
  maxDepthWarning: number;
  autoRefresh: boolean;
}

export function getConfig(): DepGraphConfig {
  const cfg = vscode.workspace.getConfiguration('depgraph');
  return {
    pythonPath: cfg.get<string>('pythonPath', 'python3'),
    language: cfg.get<string>('language', 'auto'),
    hideExternal: cfg.get<boolean>('hideExternal', true),
    hideIsolated: cfg.get<boolean>('hideIsolated', false),
    maxDepthWarning: cfg.get<number>('maxDepthWarning', 8),
    autoRefresh: cfg.get<boolean>('autoRefresh', true),
  };
}

export function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders?.[0]?.uri.fsPath;
}
