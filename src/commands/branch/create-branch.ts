import { API } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { BranchesProvider } from '../../git/branches-provider';
import { getRepo, validateBranchName } from '../utils';

/**
 * Commande "Créer une branche" — accessible via le bouton (+) dans le titre de la vue.
 *
 * Crée une nouvelle branche depuis HEAD et bascule dessus immédiatement (checkout: true).
 * Un rafraîchissement manuel est nécessaire ici car createBranch() ne déclenche pas
 * toujours repo.state.onDidChange de manière fiable.
 */
export function registerCreateBranch(gitApi: API, provider: BranchesProvider): vscode.Disposable {
    return vscode.commands.registerCommand('haerphi-yogit.create-branch', async () => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        const name = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('New branch name'),
            placeHolder: vscode.l10n.t('e.g. feature/my-feature'),
            validateInput: validateBranchName,
        });
        if (!name) {
            return;
        }

        try {
            // Le second argument `true` déclenche un checkout automatique sur la nouvelle branche.
            await repo.createBranch(name, true);
            provider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('Could not create branch: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });
}
