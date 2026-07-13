import { API, Branch, RefType, Repository } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { BranchLeaf } from '../../git/branches-provider';
import { runGit } from '../../git/git-exec';
import { getRepo } from '../utils';

/**
 * Exécute `git switch <args>` via le helper partagé (child_process + gitApi.git.path).
 *
 * Pourquoi child_process plutôt que l'API vscode.git ?
 *   L'API n'expose ni l'option "force" ni "--track" sur checkout(). On doit donc
 *   appeler git directement pour ces variantes. Voir git-exec.ts pour la gestion
 *   d'erreur (message toujours exploitable, échec de spawn géré).
 */
async function gitSwitch(gitPath: string, args: string[], cwd: string): Promise<void> {
    await runGit(gitPath, ['switch', ...args], cwd);
}

/**
 * Nom de la branche locale correspondant à une feuille distante ("origin/foo" → "foo"),
 * ou undefined si la feuille n'est pas une branche distante.
 */
function localNameFor(branch: Branch): string | undefined {
    if (branch.type !== RefType.RemoteHead || !branch.remote || !branch.name) {
        return undefined;
    }
    return branch.name.slice(branch.remote.length + 1);
}

async function localBranchExists(repo: Repository, name: string): Promise<boolean> {
    const locals = await repo.getBranches({ remote: false });
    return locals.some(b => b.name === name);
}

/**
 * Enregistre les deux variantes de basculement de branche.
 *
 * Les deux commandes acceptent aussi les feuilles de la vue "remotes" : basculer sur
 * "origin/foo" atterrit sur la branche locale "foo" — créée avec son tracking
 * (`git switch --track origin/foo`) si elle n'existe pas encore.
 *
 * Retourne un tableau de Disposables car les deux commandes sont liées
 * et doivent être enregistrées ensemble.
 */
export function registerSwitch(gitApi: API): vscode.Disposable[] {
    /**
     * Switch standard — déclenché par un clic sur le nom de la branche (via item.command)
     * ou via le menu contextuel.
     *
     * Après checkout(), on appelle repo.status() pour forcer vscode.git à relire HEAD.
     * Sans cela, repo.state.HEAD reste sur l'ancienne branche et la TreeView ne se met
     * pas à jour malgré le changement réel dans git.
     */
    const switchTo = vscode.commands.registerCommand('haerphi-yogit.switch', async (node: BranchLeaf) => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        const branchName = node.branch.name;
        if (!branchName) {
            return;
        }

        try {
            const localName = localNameFor(node.branch);
            if (localName === undefined) {
                await repo.checkout(branchName);
            } else if (await localBranchExists(repo, localName)) {
                await repo.checkout(localName);
            } else {
                await gitSwitch(gitApi.git.path, ['--track', branchName], repo.rootUri.fsPath);
            }
            // repo.status() force la mise à jour de repo.state.HEAD, ce qui déclenche
            // repo.state.onDidChange → BranchesProvider rafraîchit la TreeView.
            await repo.status();
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('Could not switch branch: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });

    /**
     * Switch forcé (`git switch -f`) — écrase les modifications locales non commitées.
     * Nécessite une confirmation explicite avant d'exécuter, car l'opération est destructrice.
     *
     * Après l'opération (faite hors API via child_process), repo.status() est appelé
     * pour synchroniser l'état de vscode.git avec le nouveau HEAD.
     */
    const switchForce = vscode.commands.registerCommand('haerphi-yogit.switch-force', async (node: BranchLeaf) => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        const branchName = node.branch.name;
        if (!branchName) {
            return;
        }

        const forceLabel = vscode.l10n.t('Force');
        const confirm = await vscode.window.showWarningMessage(
            vscode.l10n.t('Force switch to "{0}"? Uncommitted local changes will be lost.', branchName),
            { modal: true },
            forceLabel,
        );
        if (confirm !== forceLabel) {
            return;
        }

        try {
            const localName = localNameFor(node.branch);
            if (localName === undefined) {
                await gitSwitch(gitApi.git.path, ['-f', branchName], repo.rootUri.fsPath);
            } else if (await localBranchExists(repo, localName)) {
                await gitSwitch(gitApi.git.path, ['-f', localName], repo.rootUri.fsPath);
            } else {
                await gitSwitch(gitApi.git.path, ['-f', '--track', branchName], repo.rootUri.fsPath);
            }
            await repo.status();
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('git switch -f failed: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });

    return [switchTo, switchForce];
}
