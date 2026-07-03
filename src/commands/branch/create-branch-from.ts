import { API } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { BranchLeaf, BranchesProvider } from '../../git/branches-provider';
import { getRepo, validateBranchName } from '../utils';

/**
 * Commande "Créer une branche depuis celle-ci" — accessible via le clic droit sur un nœud branche.
 *
 * Contrairement à create-branch qui part de HEAD, cette commande passe node.branch.commit
 * comme point de départ, ce qui permet de créer une branche depuis n'importe quel commit,
 * y compris une branche distante (ex: origin/main) sans avoir à la checkout au préalable.
 */
export function registerCreateBranchFrom(gitApi: API, provider: BranchesProvider): vscode.Disposable {
    return vscode.commands.registerCommand('haerphi-yogit.create-branch-from', async (node: BranchLeaf) => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        const sourceName = node.branch.name ?? 'inconnue';
        const name = await vscode.window.showInputBox({
            prompt: `Nouvelle branche depuis « ${sourceName} »`,
            placeHolder: 'ex: feature/ma-fonctionnalite',
            validateInput: validateBranchName,
        });
        if (!name) {
            return;
        }

        try {
            // node.branch.commit ancre la nouvelle branche sur le commit de la branche source,
            // pas sur HEAD — comportement attendu quand on part d'une branche distante.
            await repo.createBranch(name, true, node.branch.commit);
            provider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(
                `Impossible de créer la branche : ${err instanceof Error ? err.message : err}`,
            );
        }
    });
}
