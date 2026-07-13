import { API } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { BranchLeaf } from '../../git/branches-provider';
import { runGit } from '../../git/git-exec';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { getRepo } from '../utils';

/**
 * Exécute `git push <remote> --delete <branch>` via child_process.
 *
 * L'API vscode.git n'expose pas de méthode dédiée pour supprimer une branche distante.
 * push() existe mais ne prend pas de refspec "delete". On passe donc par git directement.
 *
 * Voir switch.ts (gitSwitchForce) pour les raisons du choix de spawn et de gitApi.git.path.
 */
async function gitDeleteRemoteBranch(gitPath: string, remote: string, branch: string, cwd: string): Promise<void> {
    await runGit(gitPath, ['push', remote, '--delete', branch], cwd);
}

/**
 * Enregistre les deux commandes de suppression de branche :
 *   - haerphi-yogit.delete-branch        → branche locale (contextValue: branch-local)
 *   - haerphi-yogit.delete-branch-remote → branche distante (contextValue: branch-remote)
 */
export function registerDeleteBranch(gitApi: API, context: vscode.ExtensionContext): vscode.Disposable[] {
    /**
     * Suppression d'une branche locale.
     *
     * Flux :
     *   1. Vérifier qu'on ne supprime pas la branche courante (git l'interdirait de toute façon).
     *   2. Récupérer les infos complètes via getBranch() — getBranches() ne retourne pas upstream.
     *   3. Afficher une modale custom avec une checkbox optionnelle "supprimer aussi le distant".
     *   4. Tenter deleteBranch(false). En cas d'échec (branche non mergée), proposer de forcer.
     *   5. Si la checkbox était cochée, supprimer aussi la branche distante de suivi.
     *   6. repo.status() pour synchroniser l'état de vscode.git et mettre à jour la TreeView.
     */
    const deleteLocal = vscode.commands.registerCommand('haerphi-yogit.delete-branch', async (node: BranchLeaf) => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        const branchName = node.branch.name;
        if (!branchName) {
            return;
        }

        // Bloquer la suppression de la branche actuellement checkoutée.
        const isCurrent = branchName === repo.state.HEAD?.name;
        if (isCurrent) {
            vscode.window.showErrorMessage(vscode.l10n.t('Cannot delete the current branch "{0}".', branchName));
            return;
        }

        // getBranches() ne remonte pas upstream — getBranch() retourne le Branch complet
        // avec upstream, ahead/behind, etc.
        const fullBranch = await repo.getBranch(branchName);
        const upstream = fullBranch.upstream;
        const upstreamLabel = upstream ? `${upstream.remote}/${upstream.name}` : undefined;

        const result = await ConfirmModal.show(context, {
            title: vscode.l10n.t('Delete Local Branch'),
            message: vscode.l10n.t('Delete local branch "{0}"?', branchName),
            detail: vscode.l10n.t('This will delete the branch from your local repository.'),
            buttons: [
                { label: vscode.l10n.t('Cancel'), value: 'cancel', variant: 'secondary' },
                { label: vscode.l10n.t('Delete'), value: 'confirm', variant: 'danger' },
            ],
            // La checkbox n'apparaît que si une branche distante de suivi existe.
            checkboxes: upstreamLabel
                ? [
                      {
                          id: 'deleteRemote',
                          label: vscode.l10n.t('Also delete the remote branch ({0})', upstreamLabel),
                          checked: false,
                      },
                  ]
                : undefined,
        });

        if (!result || result.button !== 'confirm') {
            return;
        }

        // Si la checkbox est cochée, confirmer la suppression distante AVANT de toucher
        // au local — l'utilisateur peut encore tout annuler sans effet de bord.
        const deleteRemoteAlso = result.checkboxes['deleteRemote'] && upstream;
        if (deleteRemoteAlso && upstream) {
            const upstreamFullName = `${upstream.remote}/${upstream.name}`;

            const remoteConfirm = await ConfirmModal.show(context, {
                title: vscode.l10n.t('Delete Remote Branch'),
                message: vscode.l10n.t('Also delete "{0}" from the remote repository?', upstreamFullName),
                warning: vscode.l10n.t(
                    'This operation affects the shared repository. Other contributors will lose access to this branch.',
                ),
                buttons: [
                    { label: vscode.l10n.t('Cancel'), value: 'cancel', variant: 'secondary' },
                    { label: vscode.l10n.t('Delete Permanently'), value: 'confirm', variant: 'danger' },
                ],
            });

            if (!remoteConfirm || remoteConfirm.button !== 'confirm') {
                return;
            }
        }

        // Suppression locale — premier essai sans forcer.
        try {
            await repo.deleteBranch(branchName, false);
        } catch {
            // deleteBranch(false) échoue si la branche contient des commits non mergés.
            // On propose un second essai avec force, accompagné d'un avertissement explicite.
            const forceResult = await ConfirmModal.show(context, {
                title: vscode.l10n.t('Branch Not Merged'),
                message: vscode.l10n.t('"{0}" is not fully merged.', branchName),
                detail: vscode.l10n.t('Some commits on this branch are not present in the current branch.'),
                warning: vscode.l10n.t('Force deleting will permanently discard these commits.'),
                buttons: [
                    { label: vscode.l10n.t('Cancel'), value: 'cancel', variant: 'secondary' },
                    { label: vscode.l10n.t('Force Delete'), value: 'force', variant: 'danger' },
                ],
            });

            if (!forceResult || forceResult.button !== 'force') {
                return;
            }

            try {
                await repo.deleteBranch(branchName, true);
            } catch (err) {
                vscode.window.showErrorMessage(
                    vscode.l10n.t('Could not delete branch: {0}', err instanceof Error ? err.message : String(err)),
                );
                return;
            }
        }

        // Suppression distante — déjà confirmée plus haut, on exécute directement.
        if (deleteRemoteAlso && upstream) {
            try {
                await gitDeleteRemoteBranch(gitApi.git.path, upstream.remote, upstream.name, repo.rootUri.fsPath);
            } catch (err) {
                vscode.window.showErrorMessage(
                    vscode.l10n.t(
                        'Local branch deleted, but the remote branch could not be deleted: {0}',
                        err instanceof Error ? err.message : String(err),
                    ),
                );
            }
        }

        await repo.status();
    });

    /**
     * Suppression d'une branche distante.
     *
     * Deux modales de confirmation obligatoires pour cette opération irréversible sur le dépôt partagé :
     *   1. Avertissement sur la nature de l'opération (impact sur les autres contributeurs).
     *   2. Confirmation explicite avec le nom complet de la branche.
     *
     * Le nom court de la branche est extrait de fullName en retirant le préfixe remote + "/".
     * Ex: "origin/main" avec remote="origin" → branchName="main".
     */
    const deleteRemote = vscode.commands.registerCommand(
        'haerphi-yogit.delete-branch-remote',
        async (node: BranchLeaf) => {
            const repo = getRepo(gitApi);
            if (!repo) {
                return;
            }

            const fullName = node.branch.name;
            const remoteName = node.branch.remote;
            if (!fullName || !remoteName) {
                return;
            }

            // fullName est "origin/main" → on extrait "main"
            const branchName = fullName.slice(remoteName.length + 1);

            // Premier avertissement : nature irréversible et impact partagé.
            const firstResult = await ConfirmModal.show(context, {
                title: vscode.l10n.t('Delete Remote Branch'),
                message: vscode.l10n.t('You are about to delete "{0}" from the remote repository.', fullName),
                warning: vscode.l10n.t(
                    'This operation affects the shared repository. Other contributors will lose access to this branch and it cannot be easily restored.',
                ),
                buttons: [
                    { label: vscode.l10n.t('Cancel'), value: 'cancel', variant: 'secondary' },
                    { label: vscode.l10n.t('Continue'), value: 'continue', variant: 'primary' },
                ],
            });

            if (!firstResult || firstResult.button !== 'continue') {
                return;
            }

            // Second avertissement : confirmation explicite avec le nom de la branche.
            const secondResult = await ConfirmModal.show(context, {
                title: vscode.l10n.t('Confirm Deletion'),
                message: vscode.l10n.t('Permanently delete "{0}"?', fullName),
                detail: vscode.l10n.t('This action is irreversible.'),
                buttons: [
                    { label: vscode.l10n.t('Cancel'), value: 'cancel', variant: 'secondary' },
                    { label: vscode.l10n.t('Delete Permanently'), value: 'confirm', variant: 'danger' },
                ],
            });

            if (!secondResult || secondResult.button !== 'confirm') {
                return;
            }

            try {
                await gitDeleteRemoteBranch(gitApi.git.path, remoteName, branchName, repo.rootUri.fsPath);
                await repo.status();
            } catch (err) {
                vscode.window.showErrorMessage(
                    vscode.l10n.t(
                        'Could not delete remote branch: {0}',
                        err instanceof Error ? err.message : String(err),
                    ),
                );
            }
        },
    );

    return [deleteLocal, deleteRemote];
}
