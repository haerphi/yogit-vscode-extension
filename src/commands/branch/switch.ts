import { API } from '@haerphi/vscode-git-api-types';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { BranchLeaf } from '../../git/branches-provider';
import { getRepo } from '../utils';

/**
 * Exécute `git switch -f <branchName>` via child_process en utilisant le binaire git
 * que vscode.git utilise lui-même (gitApi.git.path).
 *
 * Pourquoi child_process plutôt que l'API vscode.git ?
 *   L'API n'expose pas d'option "force" sur checkout(). On doit donc appeler git directement.
 *
 * Pourquoi gitApi.git.path plutôt que "git" en dur ?
 *   En mode Remote WSL, l'extension host tourne dans WSL — child_process.spawn s'exécute
 *   aussi dans WSL et git.path pointe vers le bon binaire Linux. Hardcoder "git" pourrait
 *   pointer vers un git différent ou absent selon l'environnement.
 *
 * Pourquoi spawn et non exec ?
 *   spawn streame stderr en temps réel, ce qui permet de collecter le message d'erreur
 *   exact que git retourne pour le passer dans showErrorMessage.
 */
function gitSwitchForce(gitPath: string, branchName: string, cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const proc = spawn(gitPath, ['switch', '-f', branchName], { cwd });
        const stderr: string[] = [];

        proc.stderr.on('data', (data: Buffer) => {
            stderr.push(data.toString());
        });
        proc.on('close', code => {
            if (code === 0) {
                resolve('');
            } else {
                reject(new Error(stderr.join('').trim()));
            }
        });
    });
}

/**
 * Enregistre les deux variantes de basculement de branche.
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
            await repo.checkout(branchName);
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
            await gitSwitchForce(gitApi.git.path, branchName, repo.rootUri.fsPath);
            await repo.status();
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('git switch -f failed: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });

    return [switchTo, switchForce];
}
