import { API } from '@haerphi/vscode-git-api-types';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { offerConflictResolution } from '../git/conflict-helper';
import { RebaseEntry } from '../types/rebase';

export class RebasePanel {
    private static _panel: vscode.WebviewPanel | undefined;

    /**
     * Ouvre le panneau de rebase interactif.
     *
     * @param upstream  Ref git servant de base (nom de branche ou hash de commit).
     *                  Les commits entre upstream et HEAD sont proposés au rebase.
     * @param upstreamLabel  Libellé affiché dans l'UI (peut être identique à upstream).
     */
    static async show(
        context: vscode.ExtensionContext,
        gitApi: API,
        upstream: string,
        upstreamLabel: string,
    ): Promise<void> {
        const repo = gitApi.repositories[0];
        if (!repo) {
            vscode.window.showErrorMessage(vscode.l10n.t('No git repository detected.'));
            return;
        }

        if (RebasePanel._panel) {
            RebasePanel._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'yogit-rebase',
            vscode.l10n.t('Interactive Rebase → {0}', upstreamLabel),
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
            },
        );

        RebasePanel._panel = panel;

        panel.onDidDispose(() => {
            RebasePanel._panel = undefined;
        });

        panel.webview.html = RebasePanel._buildHtml(panel.webview, context);

        panel.webview.onDidReceiveMessage(async (msg: { type: string; entries?: RebaseEntry[] }) => {
            if (msg.type === 'ready') {
                try {
                    const entries = await RebasePanel._loadEntries(gitApi.git.path, repo.rootUri.fsPath, upstream);
                    panel.webview.postMessage({ type: 'entries', entries, upstreamLabel });
                } catch (err) {
                    panel.webview.postMessage({
                        type: 'error',
                        message: err instanceof Error ? err.message : String(err),
                    });
                }
            } else if (msg.type === 'start' && msg.entries) {
                panel.webview.postMessage({ type: 'running' });
                try {
                    await RebasePanel._executeRebase(gitApi.git.path, repo.rootUri.fsPath, msg.entries, upstream);
                    await repo.status();
                    panel.webview.postMessage({ type: 'done' });
                    vscode.window.showInformationMessage(
                        vscode.l10n.t('Interactive rebase onto "{0}" completed.', upstreamLabel),
                    );
                } catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);

                    await offerConflictResolution(repo, gitApi, context);

                    // Proposer d'annuler le rebase si git est en état REBASE_MERGE
                    const abortLabel = vscode.l10n.t('Abort Rebase');
                    const action = await vscode.window.showErrorMessage(
                        vscode.l10n.t('Interactive rebase failed (likely conflicts).'),
                        { detail: errMsg },
                        abortLabel,
                    );

                    if (action === abortLabel) {
                        try {
                            await RebasePanel._spawnGit(gitApi.git.path, ['rebase', '--abort'], repo.rootUri.fsPath);
                            await repo.status();
                            vscode.window.showInformationMessage(
                                vscode.l10n.t('Rebase aborted. The branch is back to its initial state.'),
                            );
                            panel.webview.postMessage({
                                type: 'rebase-error',
                                message: errMsg + '\n\n→ ' + vscode.l10n.t('Rebase aborted.'),
                            });
                        } catch {
                            panel.webview.postMessage({ type: 'rebase-error', message: errMsg });
                        }
                    } else {
                        panel.webview.postMessage({ type: 'rebase-error', message: errMsg });
                    }
                }
            } else if (msg.type === 'cancel') {
                panel.dispose();
            }
        });
    }

    /**
     * Retourne les commits entre `upstream` et HEAD, du plus ancien au plus récent.
     * C'est l'ordre attendu par git rebase -i (top = appliqué en premier).
     */
    private static _loadEntries(gitPath: string, cwd: string, upstream: string): Promise<RebaseEntry[]> {
        return new Promise((resolve, reject) => {
            const proc = spawn(gitPath, ['log', '--reverse', `${upstream}..HEAD`, '--format=%H%x00%s%x00%ar'], { cwd });
            const out: string[] = [];
            const err: string[] = [];
            proc.stdout.on('data', (d: Buffer) => out.push(d.toString()));
            proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
            proc.on('close', code => {
                if (code !== 0) {
                    reject(new Error(err.join('').trim() || `git log a échoué (code ${code})`));
                    return;
                }
                const lines = out
                    .join('')
                    .split('\n')
                    .filter(l => l.includes('\x00'));
                resolve(
                    lines.map(line => {
                        const [hash, message, date] = line.split('\x00');
                        const h = hash.trim();
                        return {
                            action: 'pick' as const,
                            hash: h,
                            shortHash: h.slice(0, 7),
                            message: message?.trim() ?? '',
                            date: date?.trim() ?? '',
                        };
                    }),
                );
            });
        });
    }

    /**
     * Construit le fichier todo rebase, l'écrit dans un temp, et lance `git rebase -i`
     * avec GIT_SEQUENCE_EDITOR pointant vers une commande qui remplace le todo de git
     * par le nôtre.
     *
     * Pourquoi GIT_SEQUENCE_EDITOR = `cp "<our-todo>"` ?
     *   git exécute : sh -c "$GIT_SEQUENCE_EDITOR $REBASE_TODO_FILE"
     *   → sh -c `cp "/tmp/yogit-todo" /path/to/.git/rebase-merge/git-rebase-todo`
     *   Le chemin destination est concaténé directement à notre commande.
     *   Sur git-for-windows, git utilise son sh MINGW, donc `cp` est disponible.
     *
     * Pourquoi GIT_EDITOR=true ?
     *   Pour les actions `squash`, git ouvre l'éditeur pour combiner les messages.
     *   `true` (ou `:` sur POSIX) sort sans modifier le fichier — git garde le message
     *   auto-généré (concaténation des messages). L'utilisateur peut amender ensuite.
     *
     * Pourquoi `reword` est converti en `pick` + `exec git commit --amend -F <fichier>` ?
     *   git rebase -i avec `reword` appelle GIT_EDITOR une fois par commit renommé, de façon
     *   séquentielle. Plutôt que d'orchestrer un éditeur personnalisé appelé N fois, on écrit
     *   le nouveau message dans un fichier temporaire dédié et on insère une ligne `exec` dans
     *   le todo pour chaque reword. Ainsi le rebase reste entièrement non-interactif.
     */
    private static async _executeRebase(
        gitPath: string,
        cwd: string,
        entries: RebaseEntry[],
        upstream: string,
    ): Promise<void> {
        const tmpDir = os.tmpdir();
        const token = randomBytes(4).toString('hex');
        const rewordFiles: string[] = [];
        const todoLines: string[] = [];

        for (const e of entries) {
            if (e.action === 'reword') {
                const msgPath = path.join(tmpDir, `yogit-reword-${rewordFiles.length}-${token}.txt`);
                fs.writeFileSync(msgPath, (e.newMessage ?? e.message).trim() + '\n', 'utf8');
                rewordFiles.push(msgPath);
                todoLines.push(`pick ${e.hash} ${e.message}`);
                todoLines.push(`exec git commit --amend -F "${RebasePanel._toGitShellPath(msgPath)}"`);
            } else {
                todoLines.push(`${e.action} ${e.hash} ${e.message}`);
            }
        }

        const todoPath = path.join(tmpDir, `yogit-rebase-todo-${token}`);
        fs.writeFileSync(todoPath, todoLines.join('\n') + '\n', 'utf8');

        const seqEditor = `cp "${RebasePanel._toGitShellPath(todoPath)}"`;

        try {
            await RebasePanel._spawnGit(gitPath, ['rebase', '-i', upstream], cwd, {
                GIT_SEQUENCE_EDITOR: seqEditor,
                GIT_EDITOR: 'true',
            });
        } finally {
            for (const f of [todoPath, ...rewordFiles]) {
                try {
                    fs.unlinkSync(f);
                } catch {
                    /* ignore */
                }
            }
        }
    }

    /**
     * Convertit un chemin OS en chemin compatible POSIX pour le sh embarqué de
     * git-for-windows. Sur Linux/WSL, retourne le chemin sans modification.
     *
     * Ex: C:\Users\foo\AppData\Local\Temp\todo → /c/Users/foo/AppData/Local/Temp/todo
     */
    private static _toGitShellPath(p: string): string {
        if (process.platform !== 'win32') {
            return p;
        }
        return p.replace(/^([A-Za-z]):/, (_, d) => '/' + d.toLowerCase()).replace(/\\/g, '/');
    }

    private static _spawnGit(
        gitPath: string,
        args: string[],
        cwd: string,
        extraEnv: Record<string, string> = {},
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const proc = spawn(gitPath, args, {
                cwd,
                env: { ...process.env, ...extraEnv },
            });
            const out: string[] = [];
            const err: string[] = [];
            proc.stdout.on('data', (d: Buffer) => out.push(d.toString()));
            proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
            proc.on('close', code => {
                if (code !== 0) {
                    reject(new Error((err.join('') || out.join('')).trim()));
                    return;
                }
                resolve(out.join(''));
            });
        });
    }

    private static _buildHtml(webview: vscode.Webview, context: vscode.ExtensionContext): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'rebase.js'),
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
    <yogit-rebase></yogit-rebase>
    <script nonce="${nonce}">window.__YOGIT_LOCALE__ = ${JSON.stringify(vscode.env.language)};</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
