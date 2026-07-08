import { API, ForcePushMode } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { BranchesProvider } from '../../git/branches-provider';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { getRepo } from '../utils';

async function withProgress(title: string, task: () => Promise<void>): Promise<void> {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `YoGit: ${title}` }, task);
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
        try {
            if (!head.upstream) {
                // Pas d'upstream : déterminer le remote cible
                const remotes = repo.state.remotes;
                if (remotes.length === 0) {
                    vscode.window.showErrorMessage(vscode.l10n.t('No remote repository configured.'));
                    return;
                }
                let remoteName: string;
                if (remotes.length === 1) {
                    remoteName = remotes[0].name;
                } else if (remotes.some(r => r.name === 'origin')) {
                    remoteName = 'origin';
                } else {
                    const picked = await vscode.window.showQuickPick(
                        remotes.map(r => r.name),
                        { placeHolder: vscode.l10n.t('Choose the remote repository') },
                    );
                    if (!picked) {
                        return;
                    }
                    remoteName = picked;
                }
                await withProgress('Push (set upstream)…', () => repo.push(remoteName, head.name!, true));
            } else {
                await withProgress('Push…', () => repo.push());
            }
            provider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('Push failed: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });

    /**
     * Push forcé, en deux saveurs :
     *   - --force-with-lease : refuse le push si la branche distante a bougé depuis le
     *     dernier fetch — protège les commits pushés par d'autres entre-temps.
     *   - --force : écrase inconditionnellement la branche distante.
     *
     * Les deux réécrivent l'historique distant → modale de confirmation avec bandeau
     * warning obligatoire. Un upstream configuré est requis : sans upstream il n'y a
     * rien à écraser, un push normal suffit.
     */
    const forcePush = async (mode: ForcePushMode): Promise<void> => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }
        const head = repo.state.HEAD;
        if (!head?.name) {
            vscode.window.showErrorMessage(vscode.l10n.t('No active branch.'));
            return;
        }
        const upstream = head.upstream;
        if (!upstream) {
            vscode.window.showErrorMessage(vscode.l10n.t('The current branch has no configured upstream branch.'));
            return;
        }

        const upstreamLabel = `${upstream.remote}/${upstream.name}`;
        const withLease = mode === ForcePushMode.ForceWithLease;

        const result = await ConfirmModal.show(context, {
            title: withLease ? vscode.l10n.t('Force Push (With Lease)') : vscode.l10n.t('Force Push'),
            message: withLease
                ? vscode.l10n.t('Push "{0}" to "{1}" with --force-with-lease?', head.name, upstreamLabel)
                : vscode.l10n.t('Push "{0}" to "{1}" with --force?', head.name, upstreamLabel),
            detail: withLease
                ? vscode.l10n.t('The push will be refused if the remote branch was updated since your last fetch.')
                : undefined,
            warning: vscode.l10n.t(
                'This will overwrite the remote branch history. Commits pushed by others may be permanently lost.',
            ),
            buttons: [
                { label: vscode.l10n.t('Cancel'), value: 'cancel', variant: 'secondary' },
                { label: vscode.l10n.t('Force Push'), value: 'confirm', variant: 'danger' },
            ],
        });

        if (!result || result.button !== 'confirm') {
            return;
        }

        try {
            const title = withLease ? 'Push --force-with-lease…' : 'Push --force…';
            await withProgress(title, () => repo.push(upstream.remote, head.name!, false, mode));
            provider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('Push failed: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    };

    const pushForceWithLease = vscode.commands.registerCommand('haerphi-yogit.push-force-with-lease', () =>
        forcePush(ForcePushMode.ForceWithLease),
    );
    const pushForce = vscode.commands.registerCommand('haerphi-yogit.push-force', () => forcePush(ForcePushMode.Force));

    return [fetch, pull, push, pushForceWithLease, pushForce];
}
