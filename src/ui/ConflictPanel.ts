import { API, Repository } from '@haerphi/vscode-git-api-types';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { resolveWebviewLocale } from '../config';
import { runGit } from '../git/git-exec';
import { ConflictFile, ConflictHunk, FileSection } from '../types/conflict';

export class ConflictPanel {
    private static _panel: vscode.WebviewPanel | undefined;
    // Fichier actuellement affiché. Le handler onDidReceiveMessage n'est enregistré
    // qu'une fois (à la création du panel) : sans cet état mutable, sa closure
    // resterait figée sur le premier fichier et la sauvegarde écrirait au mauvais
    // endroit après un changement de fichier dans un panel réutilisé.
    private static _currentFsPath: string | undefined;

    static show(context: vscode.ExtensionContext, gitApi: API, fsPath: string): void {
        const repo = gitApi.repositories[0];
        if (!repo) {
            vscode.window.showErrorMessage(vscode.l10n.t('No git repository detected.'));
            return;
        }

        ConflictPanel._currentFsPath = fsPath;
        const fileName = path.basename(fsPath);

        if (ConflictPanel._panel) {
            ConflictPanel._panel.title = vscode.l10n.t('Conflicts — {0}', fileName);
            ConflictPanel._panel.reveal(vscode.ViewColumn.One);
            void ConflictPanel._postFile(ConflictPanel._panel, gitApi, repo, fsPath);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'yorgit-conflict',
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
            ConflictPanel._currentFsPath = undefined;
        });

        panel.webview.html = ConflictPanel._buildHtml(panel.webview, context);

        panel.webview.onDidReceiveMessage(async (msg: { type: string; content?: string }) => {
            // Toujours lire le fichier courant depuis l'état mutable, jamais depuis la
            // closure : le panel est réutilisé pour d'autres fichiers sans réenregistrer
            // ce handler.
            const currentFsPath = ConflictPanel._currentFsPath;
            if (!currentFsPath) {
                return;
            }
            const currentFileName = path.basename(currentFsPath);

            if (msg.type === 'ready') {
                await ConflictPanel._postFile(panel, gitApi, repo, currentFsPath);
            } else if (msg.type === 'save' && msg.content !== undefined) {
                try {
                    fs.writeFileSync(currentFsPath, msg.content, 'utf8');
                    // git add pour marquer le conflit comme résolu
                    await repo.add([currentFsPath]);
                    await repo.status();
                    vscode.window.showInformationMessage(vscode.l10n.t('{0} saved and staged.', currentFileName));

                    // mergeChanges est la source de vérité pour l'état de conflit (voir
                    // ChangesProvider) : si le fichier n'y figure plus après le staging,
                    // la résolution est terminée — inutile de laisser la vue ouverte.
                    const stillConflicted = repo.state.mergeChanges.some(c => c.uri.fsPath === currentFsPath);
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
     * Envoie au webview le fichier parsé accompagné du diff global ours↔theirs.
     * Regroupe les deux dans un seul message pour éviter un aller-retour supplémentaire ;
     * le diff peut être `null` (voir _computeDiff) sans empêcher l'affichage de la résolution.
     */
    private static async _postFile(
        panel: vscode.WebviewPanel,
        gitApi: API,
        repo: Repository,
        fsPath: string,
    ): Promise<void> {
        try {
            const file = ConflictPanel._parse(fsPath);
            const diff = await ConflictPanel._computeDiff(gitApi, repo, fsPath);
            panel.webview.postMessage({ type: 'file', file, diff });
        } catch (err) {
            panel.webview.postMessage({
                type: 'error',
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }

    /**
     * Diff unifié entre le côté « nôtre » (stage 2) et le côté « entrant » (stage 3) du
     * fichier en conflit — c.-à-d. l'ensemble des différences entre les deux versions, y
     * compris les zones fusionnées automatiquement qui n'apparaissent pas comme conflits.
     *
     * Utilise les blobs de l'index (`:2:` / `:3:`) pour rester cohérent avec les côtés
     * affichés par le panel et avec `git checkout --ours|--theirs`. Retourne `null` si le
     * diff n'est pas calculable (fichier déjà indexé, conflit add/delete sans l'un des
     * stages…) : ce n'est qu'une aide contextuelle, jamais bloquante.
     */
    private static async _computeDiff(gitApi: API, repo: Repository, fsPath: string): Promise<string | null> {
        const rel = path.relative(repo.rootUri.fsPath, fsPath).split(path.sep).join('/');
        try {
            const out = await runGit(
                gitApi.git.path,
                ['diff', '--no-color', `:2:${rel}`, `:3:${rel}`],
                repo.rootUri.fsPath,
            );
            return out.trim() === '' ? null : out;
        } catch {
            return null;
        }
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
                // Numéros 1-based dans le fichier en conflit (marqueurs compris)
                const currentStartLine = i + 1;
                // Collecter les lignes "current" jusqu'à =======
                while (i < lines.length && !lines[i].startsWith('=======')) {
                    currentLines.push(lines[i]);
                    i++;
                }
                i++; // sauter =======
                const theirsStartLine = i + 1;
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
                    currentStartLine,
                    theirsStartLine,
                    currentSelected: currentLines.map(() => false),
                    theirsSelected: theirsLines.map(() => false),
                    selectionOrder: [],
                    finalContent: '',
                    finalEdited: false,
                    touched: false,
                };
                sections.push({ type: 'conflict', hunk });
            } else {
                // Section contexte : accumuler jusqu'au prochain marqueur
                const startLine = i + 1;
                const ctxLines: string[] = [];
                while (i < lines.length && !lines[i].startsWith('<<<<<<<')) {
                    ctxLines.push(lines[i]);
                    i++;
                }
                sections.push({ type: 'context', lines: ctxLines, startLine });
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
    <yorgit-conflict></yorgit-conflict>
    <script nonce="${nonce}">window.__YORGIT_LOCALE__ = ${JSON.stringify(resolveWebviewLocale())};</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
