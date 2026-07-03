import { API } from '@haerphi/vscode-git-api-types';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { BranchLeaf } from '../../git/branches-provider';
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
function gitDeleteRemoteBranch(gitPath: string, remote: string, branch: string, cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = spawn(gitPath, ['push', remote, '--delete', branch], { cwd });
        const stderr: string[] = [];

        proc.stderr.on('data', (data: Buffer) => stderr.push(data.toString()));
        proc.on('close', code => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(stderr.join('').trim()));
            }
        });
    });
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
            vscode.window.showErrorMessage(`Impossible de supprimer la branche actuelle « ${branchName} ».`);
            return;
        }

        // getBranches() ne remonte pas upstream — getBranch() retourne le Branch complet
        // avec upstream, ahead/behind, etc.
        const fullBranch = await repo.getBranch(branchName);
        const upstream = fullBranch.upstream;
        const upstreamLabel = upstream ? `${upstream.remote}/${upstream.name}` : undefined;

        const result = await ConfirmModal.show(context, {
            title: 'Supprimer une branche locale',
            message: `Supprimer la branche locale « ${branchName} » ?`,
            detail: 'Cette action supprimera la branche de votre dépôt local.',
            buttons: [
                { label: 'Annuler', value: 'cancel', variant: 'secondary' },
                { label: 'Supprimer', value: 'confirm', variant: 'danger' },
            ],
            // La checkbox n'apparaît que si une branche distante de suivi existe.
            checkboxes: upstreamLabel
                ? [
                      {
                          id: 'deleteRemote',
                          label: `Supprimer aussi la branche distante (${upstreamLabel})`,
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
                title: 'Supprimer la branche distante',
                message: `Supprimer aussi « ${upstreamFullName} » du dépôt distant ?`,
                warning:
                    'Cette opération affecte le dépôt partagé. Les autres contributeurs perdront accès à cette branche.',
                buttons: [
                    { label: 'Annuler', value: 'cancel', variant: 'secondary' },
                    { label: 'Supprimer définitivement', value: 'confirm', variant: 'danger' },
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
                title: 'Branche non mergée',
                message: `« ${branchName} » n'est pas entièrement mergée.`,
                detail: 'Des commits sur cette branche ne sont pas présents dans la branche actuelle.',
                warning: 'Forcer la suppression entraînera la perte définitive de ces commits.',
                buttons: [
                    { label: 'Annuler', value: 'cancel', variant: 'secondary' },
                    { label: 'Forcer la suppression', value: 'force', variant: 'danger' },
                ],
            });

            if (!forceResult || forceResult.button !== 'force') {
                return;
            }

            try {
                await repo.deleteBranch(branchName, true);
            } catch (err) {
                vscode.window.showErrorMessage(
                    `Impossible de supprimer la branche : ${err instanceof Error ? err.message : err}`,
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
                    `Branche locale supprimée, mais impossible de supprimer la distante : ${err instanceof Error ? err.message : err}`,
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
                title: 'Supprimer une branche distante',
                message: `Vous êtes sur le point de supprimer « ${fullName} » du dépôt distant.`,
                warning:
                    'Cette opération affecte le dépôt partagé. Les autres contributeurs perdront accès à cette branche et elle ne pourra pas être restaurée facilement.',
                buttons: [
                    { label: 'Annuler', value: 'cancel', variant: 'secondary' },
                    { label: 'Continuer', value: 'continue', variant: 'primary' },
                ],
            });

            if (!firstResult || firstResult.button !== 'continue') {
                return;
            }

            // Second avertissement : confirmation explicite avec le nom de la branche.
            const secondResult = await ConfirmModal.show(context, {
                title: 'Confirmer la suppression',
                message: `Supprimer définitivement « ${fullName} » ?`,
                detail: 'Cette action est irréversible.',
                buttons: [
                    { label: 'Annuler', value: 'cancel', variant: 'secondary' },
                    { label: 'Supprimer définitivement', value: 'confirm', variant: 'danger' },
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
                    `Impossible de supprimer la branche distante : ${err instanceof Error ? err.message : err}`,
                );
            }
        },
    );

    return [deleteLocal, deleteRemote];
}
