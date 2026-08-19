import { API } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { getParentHashes } from '../../git/blame';
import { BlameController } from '../../ui/BlameController';
import { CommitDetailPanel } from '../../ui/CommitDetailPanel';

/**
 * Blame de la ligne courante : le contrôleur s'abonne lui-même aux évènements de
 * l'éditeur, les commandes ci-dessous n'agissent que sur la ligne qu'il affiche.
 */
export function registerBlame(gitApi: API, context: vscode.ExtensionContext): vscode.Disposable[] {
    const controller = new BlameController(gitApi);

    return [
        controller,
        vscode.commands.registerCommand('haerphi-yorgit.toggle-inline-blame', async () => {
            const config = vscode.workspace.getConfiguration('haerphi-yorgit');
            const enabled = config.get<boolean>('blame.inline', true);
            await config.update('blame.inline', !enabled, vscode.ConfigurationTarget.Global);
        }),
        vscode.commands.registerCommand('haerphi-yorgit.blame-show-commit', async () => {
            const blame = controller.current;
            if (!blame) {
                return;
            }
            if (blame.uncommitted) {
                vscode.window.showInformationMessage(vscode.l10n.t('This line is not committed yet.'));
                return;
            }

            const repo = gitApi.repositories[0];
            if (!repo) {
                return;
            }
            try {
                const parents = await getParentHashes(gitApi.git.path, repo.rootUri.fsPath, blame.hash);
                await CommitDetailPanel.show(context, gitApi, blame.hash, blame.shortHash, parents);
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(
                    vscode.l10n.t('Failed to load commit {0}: {1}', blame.shortHash, errMsg),
                );
            }
        }),
        vscode.commands.registerCommand('haerphi-yorgit.copy-blame-hash', async () => {
            const blame = controller.current;
            if (!blame || blame.uncommitted) {
                return;
            }
            await vscode.env.clipboard.writeText(blame.hash);
            vscode.window.setStatusBarMessage(
                vscode.l10n.t('Hash of commit {0} copied to the clipboard.', blame.shortHash),
                3000,
            );
        }),
    ];
}
