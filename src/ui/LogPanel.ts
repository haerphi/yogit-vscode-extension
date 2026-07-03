import { API } from '@haerphi/vscode-git-api-types';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { CommitEntry, LogRef } from '../types/log';
import { RebasePanel } from './RebasePanel';

const MAX_COMMITS = 500;

export class LogPanel {
    private static _panel: vscode.WebviewPanel | undefined;

    static show(context: vscode.ExtensionContext, gitApi: API): void {
        const repo = gitApi.repositories[0];
        if (!repo) {
            vscode.window.showErrorMessage('Aucun dépôt git détecté.');
            return;
        }

        if (LogPanel._panel) {
            LogPanel._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        const panel = vscode.window.createWebviewPanel('yogit-log', 'Historique', vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
        });

        LogPanel._panel = panel;

        const reloadCommits = async () => {
            try {
                const commits = await LogPanel._loadCommits(gitApi.git.path, repo.rootUri.fsPath);
                panel.webview.postMessage({ type: 'commits', commits });
            } catch {
                // Silently ignore reload errors — user still sees last known state
            }
        };

        const stateListener = repo.state.onDidChange(() => reloadCommits());
        panel.onDidDispose(() => {
            LogPanel._panel = undefined;
            stateListener.dispose();
        });

        panel.webview.html = LogPanel._buildHtml(panel.webview, context);

        panel.webview.onDidReceiveMessage(
            async (msg: { type: string; hash?: string; parentHashes?: string[]; shortHash?: string }) => {
                if (msg.type === 'ready') {
                    try {
                        const commits = await LogPanel._loadCommits(gitApi.git.path, repo.rootUri.fsPath);
                        panel.webview.postMessage({ type: 'commits', commits });
                    } catch (err) {
                        panel.webview.postMessage({
                            type: 'error',
                            message: err instanceof Error ? err.message : String(err),
                        });
                    }
                } else if (msg.type === 'load-diff' && msg.hash) {
                    try {
                        const [meta, rawDiff] = await Promise.all([
                            LogPanel._getCommitMeta(gitApi.git.path, repo.rootUri.fsPath, msg.hash),
                            LogPanel._getCommitDiff(
                                gitApi.git.path,
                                repo.rootUri.fsPath,
                                msg.hash,
                                msg.parentHashes ?? [],
                            ),
                        ]);
                        panel.webview.postMessage({ type: 'diff', hash: msg.hash, ...meta, rawDiff });
                    } catch (err) {
                        panel.webview.postMessage({
                            type: 'diff-error',
                            message: err instanceof Error ? err.message : String(err),
                        });
                    }
                } else if (msg.type === 'cherry-pick' && msg.hash) {
                    try {
                        await LogPanel._spawnGit(gitApi.git.path, ['cherry-pick', msg.hash], repo.rootUri.fsPath);
                        vscode.window.showInformationMessage(`Cherry-pick de ${msg.hash.slice(0, 7)} appliqué.`);
                        await repo.status();
                    } catch (err) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        vscode.window.showErrorMessage(`Cherry-pick échoué : ${errMsg}`);
                        panel.webview.postMessage({ type: 'cherry-pick-error', message: errMsg });
                    }
                } else if (msg.type === 'revert' && msg.hash) {
                    try {
                        await LogPanel._spawnGit(
                            gitApi.git.path,
                            ['revert', '--no-edit', msg.hash],
                            repo.rootUri.fsPath,
                        );
                        vscode.window.showInformationMessage(`Revert de ${msg.hash.slice(0, 7)} appliqué.`);
                        await repo.status();
                    } catch (err) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        vscode.window.showErrorMessage(`Revert échoué : ${errMsg}`);
                        panel.webview.postMessage({ type: 'cherry-pick-error', message: errMsg });
                    }
                } else if (msg.type === 'rebase-interactive' && msg.hash && msg.shortHash) {
                    // L'upstream est le parent du commit cliqué : on rebase depuis ce commit (inclus) jusqu'à HEAD.
                    const upstream = `${msg.hash}^`;
                    const label = msg.shortHash;
                    await RebasePanel.show(context, gitApi, upstream, label);
                } else if (msg.type === 'reset-to-commit' && msg.hash && msg.shortHash) {
                    const option = await vscode.window.showQuickPick(
                        [
                            {
                                label: '$(circle-filled) Soft',
                                description: 'Conserver les changements indexés',
                                detail: 'git reset --soft — déplace HEAD, garde le staging intact.',
                                mode: '--soft',
                            },
                            {
                                label: '$(circle-outline) Mixed',
                                description: 'Conserver les changements non indexés',
                                detail: 'git reset --mixed — déplace HEAD et vide le staging (défaut).',
                                mode: '--mixed',
                            },
                            {
                                label: '$(error) Hard',
                                description: 'Supprimer tous les changements locaux',
                                detail: 'git reset --hard — déplace HEAD, vide le staging ET les fichiers. Irréversible.',
                                mode: '--hard',
                            },
                        ],
                        {
                            title: `Reset sur ${msg.shortHash}`,
                            placeHolder: 'Choisir le type de reset…',
                            matchOnDescription: true,
                            matchOnDetail: true,
                        },
                    );
                    if (!option) {
                        return;
                    }
                    if (option.mode === '--hard') {
                        const confirm = await vscode.window.showWarningMessage(
                            `Reset hard sur ${msg.shortHash} ?`,
                            {
                                modal: true,
                                detail: 'Tous les changements locaux non commités seront définitivement supprimés.',
                            },
                            'Reset hard',
                        );
                        if (confirm !== 'Reset hard') {
                            return;
                        }
                    }
                    try {
                        await LogPanel._spawnGit(
                            gitApi.git.path,
                            ['reset', option.mode, msg.hash],
                            repo.rootUri.fsPath,
                        );
                        await repo.status();
                        vscode.window.showInformationMessage(`Reset ${option.mode} sur ${msg.shortHash} effectué.`);
                    } catch (err) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        vscode.window.showErrorMessage(`Reset échoué : ${errMsg}`);
                    }
                } else if (msg.type === 'switch-to-commit' && msg.hash && msg.shortHash) {
                    const confirm = await vscode.window.showWarningMessage(
                        `Basculer sur le commit ${msg.shortHash} ?`,
                        {
                            detail: "La HEAD sera détachée (detached HEAD). Vous ne serez plus sur une branche — tout nouveau commit sera orphelin jusqu'à ce que vous créiez ou basculiez sur une branche.",
                            modal: true,
                        },
                        'Basculer quand même',
                    );
                    if (confirm !== 'Basculer quand même') {
                        return;
                    }
                    try {
                        await LogPanel._spawnGit(gitApi.git.path, ['checkout', msg.hash], repo.rootUri.fsPath);
                        await repo.status();
                        vscode.window.showInformationMessage(
                            `HEAD détachée sur ${msg.shortHash}. Créez une branche pour conserver vos commits.`,
                        );
                    } catch (err) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        vscode.window.showErrorMessage(`Basculement échoué : ${errMsg}`);
                    }
                }
            },
        );
    }

    private static _spawnGit(gitPath: string, args: string[], cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const proc = spawn(gitPath, args, { cwd });
            const out: string[] = [];
            const err: string[] = [];
            proc.stdout.on('data', (d: Buffer) => out.push(d.toString()));
            proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
            proc.on('close', code => {
                if (code !== 0) {
                    reject(new Error(err.join('').trim()));
                    return;
                }
                resolve(out.join(''));
            });
        });
    }

    private static _loadCommits(gitPath: string, cwd: string): Promise<CommitEntry[]> {
        return new Promise((resolve, reject) => {
            const proc = spawn(
                gitPath,
                // --exclude doit précéder --all pour que git l'applique avant l'expansion de toutes les refs
                [
                    'log',
                    '--exclude=refs/stash',
                    '--all',
                    `--max-count=${MAX_COMMITS}`,
                    '--format=%H%x00%P%x00%an%x00%ar%x00%s%x00%D%x00%ai',
                ],
                { cwd },
            );
            const out: string[] = [];
            const err: string[] = [];
            proc.stdout.on('data', (d: Buffer) => out.push(d.toString()));
            proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
            proc.on('close', code => {
                if (code !== 0) {
                    reject(new Error(err.join('').trim()));
                    return;
                }
                const lines = out
                    .join('')
                    .split('\n')
                    .filter(l => l.includes('\x00'));
                resolve(
                    lines.map(line => {
                        const [hash, parents, author, date, message, decoration, isoDate] = line.split('\x00');
                        return {
                            hash: hash.trim(),
                            shortHash: hash.trim().slice(0, 7),
                            parentHashes: parents.trim() ? parents.trim().split(' ') : [],
                            author: author.trim(),
                            date: date.trim(),
                            isoDate: isoDate?.trim() ?? '',
                            message: message.trim(),
                            refs: LogPanel._parseRefs(decoration?.trim() ?? ''),
                        };
                    }),
                );
            });
        });
    }

    private static async _getCommitMeta(
        gitPath: string,
        cwd: string,
        hash: string,
    ): Promise<{ author: string; date: string; body: string }> {
        const raw = await LogPanel._spawnGit(gitPath, ['show', '--no-patch', `--format=%an%x00%ar%x00%B`, hash], cwd);
        const parts = raw.split('\x00');
        return {
            author: parts[0]?.trim() ?? '',
            date: parts[1]?.trim() ?? '',
            body: parts[2]?.trim() ?? '',
        };
    }

    private static async _getCommitDiff(
        gitPath: string,
        cwd: string,
        hash: string,
        parentHashes: string[],
    ): Promise<string> {
        // For commits with a parent, diff against the first parent to show exactly what this
        // commit introduced. git show uses a "combined diff" for merges which suppresses most
        // output; git diff always shows the full change set vs the chosen base.
        const args =
            parentHashes.length > 0
                ? ['diff', '--no-color', '-p', parentHashes[0], hash]
                : ['show', '--no-color', '--format=', '-p', hash];
        return LogPanel._spawnGit(gitPath, args, cwd);
    }

    private static _parseRefs(decoration: string): LogRef[] {
        if (!decoration) {
            return [];
        }
        return decoration
            .split(', ')
            .filter(r => r.trim())
            .map(r => {
                r = r.trim();
                if (r.startsWith('HEAD -> ')) {
                    return { type: 'head' as const, name: r.slice(8), isCurrent: true };
                }
                if (r === 'HEAD') {
                    return { type: 'head' as const, name: 'HEAD', isCurrent: true };
                }
                if (r.startsWith('tag: ')) {
                    return { type: 'tag' as const, name: r.slice(5), isCurrent: false };
                }
                if (r.includes('/')) {
                    return { type: 'remote' as const, name: r, isCurrent: false };
                }
                return { type: 'local' as const, name: r, isCurrent: false };
            });
    }

    private static _buildHtml(webview: vscode.Webview, context: vscode.ExtensionContext): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'log.js'));
        const nonce = randomBytes(16).toString('hex');
        return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <style>html,body{margin:0;padding:0;height:100%;overflow:hidden;}</style>
</head>
<body>
    <yogit-log></yogit-log>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
