import { API } from '@haerphi/vscode-git-api-types';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConflictFile, ConflictHunk, FileSection } from '../types/conflict';

export class ConflictPanel {
    private static _panel: vscode.WebviewPanel | undefined;

    static show(context: vscode.ExtensionContext, gitApi: API, fsPath: string): void {
        const repo = gitApi.repositories[0];
        if (!repo) {
            vscode.window.showErrorMessage(vscode.l10n.t('No git repository detected.'));
            return;
        }

        const fileName = path.basename(fsPath);

        if (ConflictPanel._panel) {
            ConflictPanel._panel.title = vscode.l10n.t('Conflicts — {0}', fileName);
            ConflictPanel._panel.reveal(vscode.ViewColumn.One);
            ConflictPanel._panel.webview.postMessage({ type: 'file', file: ConflictPanel._parse(fsPath) });
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'yogit-conflict',
            vscode.l10n.t('Conflicts — {0}', fileName),
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
            },
        );

        ConflictPanel._panel = panel;
        panel.onDidDispose(() => {
            ConflictPanel._panel = undefined;
        });

        panel.webview.html = ConflictPanel._buildHtml(panel.webview, context);

        panel.webview.onDidReceiveMessage(async (msg: { type: string; content?: string }) => {
            if (msg.type === 'ready') {
                try {
                    panel.webview.postMessage({ type: 'file', file: ConflictPanel._parse(fsPath) });
                } catch (err) {
                    panel.webview.postMessage({
                        type: 'error',
                        message: err instanceof Error ? err.message : String(err),
                    });
                }
            } else if (msg.type === 'save' && msg.content !== undefined) {
                try {
                    fs.writeFileSync(fsPath, msg.content, 'utf8');
                    // git add pour marquer le conflit comme résolu
                    await repo.add([fsPath]);
                    await repo.status();
                    vscode.window.showInformationMessage(vscode.l10n.t('{0} saved and staged.', fileName));

                    // mergeChanges est la source de vérité pour l'état de conflit (voir
                    // ChangesProvider) : si le fichier n'y figure plus après le staging,
                    // la résolution est terminée — inutile de laisser la vue ouverte.
                    const stillConflicted = repo.state.mergeChanges.some(c => c.uri.fsPath === fsPath);
                    if (!stillConflicted) {
                        panel.dispose();
                        return;
                    }

                    panel.webview.postMessage({ type: 'saved' });
                } catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    panel.webview.postMessage({ type: 'error', message: errMsg });
                    vscode.window.showErrorMessage(vscode.l10n.t('Save failed: {0}', errMsg));
                }
            }
        });
    }

    /**
     * Parse un fichier contenant des marqueurs de conflit git et retourne une
     * structure de sections alternant contexte et hunks de conflit.
     *
     * Format attendu :
     *   <<<<<<< HEAD
     *   ... lignes current ...
     *   =======
     *   ... lignes theirs ...
     *   >>>>>>> <ref>
     */
    private static _parse(fsPath: string): ConflictFile {
        const raw = fs.readFileSync(fsPath, 'utf8');
        const allLines = raw.split('\n');

        // Retirer la dernière ligne vide si le fichier se termine par \n
        const lines = allLines[allLines.length - 1] === '' ? allLines.slice(0, -1) : allLines;

        const sections: FileSection[] = [];
        let hunkId = 0;
        let i = 0;

        while (i < lines.length) {
            if (lines[i].startsWith('<<<<<<<')) {
                // Début d'un hunk de conflit
                const currentLines: string[] = [];
                const theirsLines: string[] = [];
                i++;
                // Collecter les lignes "current" jusqu'à =======
                while (i < lines.length && !lines[i].startsWith('=======')) {
                    currentLines.push(lines[i]);
                    i++;
                }
                i++; // sauter =======
                // Collecter les lignes "theirs" jusqu'à >>>>>>>
                while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
                    theirsLines.push(lines[i]);
                    i++;
                }
                i++; // sauter >>>>>>>

                const hunk: ConflictHunk = {
                    id: hunkId++,
                    currentLines,
                    theirsLines,
                    currentSelected: currentLines.map(() => false),
                    theirsSelected: theirsLines.map(() => false),
                    selectionOrder: [],
                    finalContent: '',
                    finalEdited: false,
                };
                sections.push({ type: 'conflict', hunk });
            } else {
                // Section contexte : accumuler jusqu'au prochain marqueur
                const ctxLines: string[] = [];
                while (i < lines.length && !lines[i].startsWith('<<<<<<<')) {
                    ctxLines.push(lines[i]);
                    i++;
                }
                sections.push({ type: 'context', lines: ctxLines });
            }
        }

        return { fsPath, fileName: path.basename(fsPath), sections };
    }

    private static _buildHtml(webview: vscode.Webview, context: vscode.ExtensionContext): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'conflict.js'),
        );
        const nonce = randomBytes(16).toString('hex');
        return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}';" />
    <style>html,body{margin:0;padding:0;height:100%;overflow:hidden;}</style>
</head>
<body>
    <yogit-conflict></yogit-conflict>
    <script nonce="${nonce}">window.__YOGIT_LOCALE__ = ${JSON.stringify(vscode.env.language)};</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
