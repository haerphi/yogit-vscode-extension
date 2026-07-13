import { API } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { BranchesProvider, BranchLeaf } from '../../git/branches-provider';
import { runGit } from '../../git/git-exec';
import { getRepo, validateBranchName } from '../utils';

/**
 * Exécute `git branch -m <old> <new>` via child_process.
 *
 * L'API vscode.git n'expose pas de méthode de renommage de branche. On passe donc
 * par git directement. Fournir l'ancien et le nouveau nom fonctionne que la branche
 * soit la branche courante ou non.
 *
 * Voir delete-branch.ts / switch.ts pour les raisons du choix de spawn et de gitApi.git.path.
 */
async function gitRenameBranch(gitPath: string, oldName: string, newName: string, cwd: string): Promise<void> {
    await runGit(gitPath, ['branch', '-m', oldName, newName], cwd);
}

/**
 * Renomme une branche locale.
 *
 * L'InputBox est pré-remplie avec le nom actuel. Renommer la branche courante est
 * autorisé (git branch -m gère ce cas). Après l'opération — faite hors API — on
 * synchronise l'état vscode.git via repo.status() et on force un refresh de la vue.
 */
export function registerRenameBranch(gitApi: API, provider: BranchesProvider): vscode.Disposable {
    return vscode.commands.registerCommand('haerphi-yogit.rename-branch', async (node: BranchLeaf) => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        const oldName = node.branch.name;
        if (!oldName) {
            return;
        }

        const newName = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('New branch name'),
            value: oldName,
            // Présélectionne le nom (sans le préfixe de dossier) pour un renommage rapide.
            valueSelection: [oldName.lastIndexOf('/') + 1, oldName.length],
            validateInput: validateBranchName,
        });
        if (!newName || newName === oldName) {
            return;
        }

        try {
            await gitRenameBranch(gitApi.git.path, oldName, newName, repo.rootUri.fsPath);
            await repo.status();
            provider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('Could not rename branch: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });
}
