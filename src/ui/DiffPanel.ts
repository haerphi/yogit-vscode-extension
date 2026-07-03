import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { FileDiff, HunkSelection } from '../types/diff';

/**
 * Panel WebviewPanel pour la sélection de hunks/lignes avant staging.
 *
 * Un panel par fichier : cliquer sur un fichier déjà ouvert révèle le panel existant
 * et recharge le diff (l'état peut avoir changé). Cliquer sur un fichier différent
 * ouvre un panel distinct.
 */
export class DiffPanel {
    private static readonly _panels = new Map<
        string,
        { panel: vscode.WebviewPanel; messageListener: vscode.Disposable; cancelCurrent: () => void }
    >();

    static show(context: vscode.ExtensionContext, diff: FileDiff): Promise<HunkSelection | null> {
        const key = diff.filePath;
        const existing = DiffPanel._panels.get(key);

        if (existing) {
            // Annuler la Promise précédente pour ce fichier, recharger le diff et révéler.
            existing.cancelCurrent();
            existing.messageListener.dispose();
            existing.panel.title = `${diff.actionLabel ?? 'Indexer'} : ${diff.filePath}`;
            existing.panel.webview.html = DiffPanel.buildHtml(existing.panel.webview, context, diff);
            existing.panel.reveal(undefined, false);
        }

        return new Promise(resolve => {
            let resolved = false;

            const panel =
                existing?.panel ??
                (() => {
                    const label = diff.actionLabel ?? 'Indexer';
                    const p = vscode.window.createWebviewPanel(
                        'yogit-diff-panel',
                        `${label} : ${diff.filePath}`,
                        vscode.ViewColumn.Active,
                        {
                            enableScripts: true,
                            retainContextWhenHidden: true,
                            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
                        },
                    );
                    p.webview.html = DiffPanel.buildHtml(p.webview, context, diff);
                    p.onDidDispose(() => {
                        const entry = DiffPanel._panels.get(key);
                        entry?.messageListener.dispose();
                        DiffPanel._panels.delete(key);
                        if (!resolved) {
                            resolved = true;
                            resolve(null);
                        }
                    });
                    return p;
                })();

            const cancelCurrent = () => {
                if (!resolved) {
                    resolved = true;
                    resolve(null);
                }
            };

            const messageListener = panel.webview.onDidReceiveMessage(
                (msg: { selection: HunkSelection } | { cancel: true }) => {
                    if (resolved) {
                        return;
                    }
                    resolved = true;
                    DiffPanel._panels.get(key)?.messageListener.dispose();
                    DiffPanel._panels.delete(key);
                    panel.dispose();
                    resolve('cancel' in msg ? null : msg.selection);
                },
            );

            DiffPanel._panels.set(key, { panel, messageListener, cancelCurrent });
        });
    }

    /** Ferme le panel "Indexer/Désindexer" ouvert pour un fichier donné, s'il existe. */
    static closeForFile(filePath: string): void {
        const entry = DiffPanel._panels.get(filePath);
        if (entry) {
            entry.panel.dispose();
        }
    }

    private static buildHtml(webview: vscode.Webview, context: vscode.ExtensionContext, diff: FileDiff): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'diff.js'));
        const nonce = randomBytes(16).toString('hex');
        const diffJson = JSON.stringify(diff).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

        return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'nonce-${nonce}'; style-src 'unsafe-inline';" />
    <style>
        html, body { margin: 0; padding: 0; height: 100%; background: var(--vscode-editor-background); }
    </style>
</head>
<body>
    <script nonce="${nonce}">window.__YOGIT_DIFF__ = ${diffJson}; window.__YOGIT_LOCALE__ = ${JSON.stringify(vscode.env.language)};</script>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
