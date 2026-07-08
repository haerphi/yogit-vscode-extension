import { API, ForcePushMode } from '@haerphi/vscode-git-api-types';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { BranchesProvider } from '../../git/branches-provider';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { getRepo } from '../utils';

async function withProgress(title: string, task: () => Promise<void>): Promise<void> {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `YoGit: ${title}` }, task);
}

/**
 * Exécute `git push` via child_process — uniquement pour le cas "--tags", que l'API
 * vscode.git n'expose pas. Les autres pushes passent par repo.push() (API), qui
 * bénéficie de l'askpass de VS Code pour l'authentification.
 */
function gitPushWithTags(
    gitPath: string,
    opts: { remote: string; branch: string; setUpstream: boolean; forceMode?: ForcePushMode },
    cwd: string,
): Promise<void> {
    const args = ['push', opts.remote, opts.branch, '--tags'];
    if (opts.setUpstream) {
        args.push('--set-upstream');
    }
    if (opts.forceMode === ForcePushMode.ForceWithLease) {
        args.push('--force-with-lease');
    } else if (opts.forceMode === ForcePushMode.Force) {
        args.push('--force');
    }

    return new Promise((resolve, reject) => {
        const proc = spawn(gitPath, args, { cwd });
        const stderr: string[] = [];
        proc.stderr.on('data', (data: Buffer) => stderr.push(data.toString()));
        proc.on('close', code => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(stderr.join('').trim()));
            }
        });
        proc.on('error', reject);
    });
}

export function registerSync(
    gitApi: API,
    provider: BranchesProvider,
    context: vscode.ExtensionContext,
): vscode.Disposable[] {
    const fetch = vscode.commands.registerCommand('haerphi-yogit.fetch', async () => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }
        try {
            await withProgress('Fetch…', () => repo.fetch());
            provider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('Fetch failed: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });

    const pull = vscode.commands.registerCommand('haerphi-yogit.pull', async () => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }
        if (!repo.state.HEAD?.upstream) {
            vscode.window.showErrorMessage(vscode.l10n.t('The current branch has no configured upstream branch.'));
            return;
        }
        try {
            await withProgress('Pull…', () => repo.pull());
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('Pull failed: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });

    /**
     * Push via une modale récapitulative (style Fork) plutôt qu'un push aveugle :
     * l'utilisateur choisit la branche, le remote cible, le mode (normal /
     * --force-with-lease / --force) et peut inclure tous les tags.
     *
     * Le mode est une liste déroulante — et non deux checkboxes — car --force et
     * --force-with-lease sont mutuellement exclusifs. Les options force portent un
     * warning affiché en bandeau orange tant qu'elles sont sélectionnées.
     */
    const push = vscode.commands.registerCommand('haerphi-yogit.push', async () => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }
        const head = repo.state.HEAD;
        if (!head?.name) {
            vscode.window.showErrorMessage(vscode.l10n.t('No active branch.'));
            return;
        }
        const remotes = repo.state.remotes;
        if (remotes.length === 0) {
            vscode.window.showErrorMessage(vscode.l10n.t('No remote repository configured.'));
            return;
        }

        const localBranches = await repo.getBranches({ remote: false });
        const branchNames = localBranches.map(b => b.name).filter((name): name is string => !!name);
        const defaultRemote =
            head.upstream?.remote ?? (remotes.some(r => r.name === 'origin') ? 'origin' : remotes[0].name);

        const result = await ConfirmModal.show(context, {
            title: vscode.l10n.t('Push'),
            message: vscode.l10n.t('Push your local changes to the remote repository.'),
            selects: [
                {
                    id: 'branch',
                    label: vscode.l10n.t('Branch'),
                    options: branchNames.map(name => ({ label: name, value: name })),
                    value: head.name,
                },
                {
                    id: 'remote',
                    label: vscode.l10n.t('To'),
                    options: remotes.map(r => ({
                        label: r.fetchUrl ? `${r.name} (${r.fetchUrl})` : r.name,
                        value: r.name,
                    })),
                    value: defaultRemote,
                },
                {
                    id: 'mode',
                    label: vscode.l10n.t('Mode'),
                    options: [
                        { label: vscode.l10n.t('Normal'), value: 'normal' },
                        {
                            label: '--force-with-lease',
                            value: 'force-with-lease',
                            warning: vscode.l10n.t(
                                'Rewrites the remote branch history. The push will be refused if the remote branch was updated since your last fetch.',
                            ),
                        },
                        {
                            label: '--force',
                            value: 'force',
                            warning: vscode.l10n.t(
                                'This will overwrite the remote branch history. Commits pushed by others may be permanently lost.',
                            ),
                        },
                    ],
                    value: 'normal',
                },
            ],
            checkboxes: [{ id: 'tags', label: vscode.l10n.t('Push all tags'), checked: false }],
            buttons: [
                { label: vscode.l10n.t('Cancel'), value: 'cancel', variant: 'secondary' },
                { label: vscode.l10n.t('Push'), value: 'confirm', variant: 'primary' },
            ],
        });

        if (!result || result.button !== 'confirm') {
            return;
        }

        const branchName = result.selects['branch'];
        const remoteName = result.selects['remote'];
        const pushTags = result.checkboxes['tags'] === true;
        const forceMode =
            result.selects['mode'] === 'force'
                ? ForcePushMode.Force
                : result.selects['mode'] === 'force-with-lease'
                  ? ForcePushMode.ForceWithLease
                  : undefined;
        if (!branchName || !remoteName) {
            return;
        }

        try {
            // Sans upstream configuré, le push le crée (--set-upstream) pour que
            // les pull/push suivants fonctionnent sans re-préciser la cible.
            let hasUpstream = false;
            try {
                hasUpstream = (await repo.getBranch(branchName)).upstream !== undefined;
            } catch {
                // Branche introuvable — on laisse git remonter l'erreur au push.
            }

            await withProgress('Push…', () =>
                pushTags
                    ? gitPushWithTags(
                          gitApi.git.path,
                          { remote: remoteName, branch: branchName, setUpstream: !hasUpstream, forceMode },
                          repo.rootUri.fsPath,
                      )
                    : repo.push(remoteName, branchName, !hasUpstream, forceMode),
            );
            provider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('Push failed: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });

    return [fetch, pull, push];
}
