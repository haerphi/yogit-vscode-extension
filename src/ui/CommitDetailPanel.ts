import { API } from '@haerphi/vscode-git-api-types';
import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { resolveWebviewLocale } from '../config';
import { runGit } from '../git/git-exec';

interface CommitMeta {
    author: string;
    date: string;
    body: string;
}

interface CommitPayload extends CommitMeta {
    hash: string;
    shortHash: string;
    rawDiff: string;
}

/**
 * WebviewPanel dédié aux modifications d'un commit — un onglet par commit examiné.
 *
 * Le contenu d'un commit est immuable : un panel est donc mis en cache par hash et
 * simplement révélé si l'on ré-examine le même commit, plutôt que recalculé. Fermer
 * l'onglet le retire du cache (voir onDidDispose).
 */
export class CommitDetailPanel {
    private static readonly _panels = new Map<string, vscode.WebviewPanel>();

    static async show(
        context: vscode.ExtensionContext,
        gitApi: API,
        hash: string,
        shortHash: string,
        parentHashes: string[],
    ): Promise<void> {
        const repo = gitApi.repositories[0];
        if (!repo) {
            vscode.window.showErrorMessage(vscode.l10n.t('No git repository detected.'));
            return;
        }
        const cwd = repo.rootUri.fsPath;

        const existing = CommitDetailPanel._panels.get(hash);
        if (existing) {
            existing.reveal(undefined, false);
            return;
        }

        let meta: CommitMeta;
        let rawDiff: string;
        try {
            [meta, rawDiff] = await Promise.all([
                CommitDetailPanel._getCommitMeta(gitApi.git.path, cwd, hash),
                CommitDetailPanel._getCommitDiff(gitApi.git.path, cwd, hash, parentHashes),
            ]);
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t(
                    'Failed to load commit {0}: {1}',
                    shortHash,
                    err instanceof Error ? err.message : String(err),
                ),
            );
            return;
        }

        const subject = meta.body.split('\n')[0]?.trim() ?? '';
        const panel = vscode.window.createWebviewPanel(
            'yorgit-commit-detail',
            subject ? `${shortHash} · ${subject}` : shortHash,
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
            },
        );
        CommitDetailPanel._panels.set(hash, panel);
        panel.onDidDispose(() => {
            CommitDetailPanel._panels.delete(hash);
        });

        panel.webview.html = CommitDetailPanel._buildHtml(panel.webview, context, {
            hash,
            shortHash,
            ...meta,
            rawDiff,
        });
    }

    private static async _getCommitMeta(gitPath: string, cwd: string, hash: string): Promise<CommitMeta> {
        const raw = await runGit(gitPath, ['show', '--no-patch', '--format=%an%x00%ar%x00%B', hash], cwd);
        const parts = raw.split('\x00');
        return {
            author: parts[0]?.trim() ?? '',
            date: parts[1]?.trim() ?? '',
            body: parts[2]?.trim() ?? '',
        };
    }

    private static _getCommitDiff(gitPath: string, cwd: string, hash: string, parentHashes: string[]): Promise<string> {
        // Pour un commit avec parent, on diffe contre le premier parent afin de montrer
        // exactement ce que ce commit introduit. `git show` produit un "combined diff" pour
        // les merges qui masque la plupart des lignes ; `git diff` montre toujours le set complet.
        const args =
            parentHashes.length > 0
                ? ['diff', '--no-color', '-p', parentHashes[0], hash]
                : ['show', '--no-color', '--format=', '-p', hash];
        return runGit(gitPath, args, cwd);
    }

    private static _buildHtml(
        webview: vscode.Webview,
        context: vscode.ExtensionContext,
        payload: CommitPayload,
    ): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'commit-detail.js'),
        );
        const nonce = randomBytes(16).toString('hex');
        // < / > échappés pour ne jamais fermer prématurément le <script> depuis le contenu du diff.
        const commitJson = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

        return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <style>html,body{margin:0;padding:0;height:100%;overflow:hidden;}</style>
</head>
<body>
    <yorgit-commit-detail></yorgit-commit-detail>
    <script nonce="${nonce}">window.__YORGIT_COMMIT__ = ${commitJson}; window.__YORGIT_LOCALE__ = ${JSON.stringify(resolveWebviewLocale())};</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
