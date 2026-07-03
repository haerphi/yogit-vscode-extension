import { API } from '@haerphi/vscode-git-api-types';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { BranchLeaf } from '../../git/branches-provider';
import { offerConflictResolution } from '../../git/conflict-helper';
import { getRepo } from '../utils';

function gitRebase(gitPath: string, onto: string, cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const proc = spawn(gitPath, ['rebase', onto], { cwd });
        const stdout: string[] = [];
        const stderr: string[] = [];

        proc.stdout.on('data', (data: Buffer) => stdout.push(data.toString()));
        proc.stderr.on('data', (data: Buffer) => stderr.push(data.toString()));

        proc.on('close', code => {
            if (code === 0) {
                resolve(stdout.join('').trim());
            } else {
                reject(new Error((stderr.join('') || stdout.join('')).trim()));
            }
        });
    });
}

function gitRebaseAbort(gitPath: string, cwd: string): Promise<void> {
    return new Promise(resolve => {
        const proc = spawn(gitPath, ['rebase', '--abort'], { cwd });
        proc.on('close', () => resolve());
    });
}

export function registerRebase(gitApi: API, context: vscode.ExtensionContext): vscode.Disposable[] {
    const rebaseOnto = vscode.commands.registerCommand('haerphi-yogit.rebase-onto', async (node: BranchLeaf) => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        const currentBranch = repo.state.HEAD?.name;
        if (!currentBranch) {
            vscode.window.showErrorMessage('Impossible de déterminer la branche courante (HEAD détaché ?)');
            return;
        }

        const targetBranch = node.branch.name;
        if (!targetBranch) {
            return;
        }

        if (targetBranch === currentBranch) {
            vscode.window.showWarningMessage('Impossible de rebaser une branche sur elle-même.');
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Rebaser « ${currentBranch} » sur « ${targetBranch} » ?`,
            {
                modal: true,
                detail:
                    'Les commits de la branche courante seront réappliqués par-dessus la cible. ' +
                    'En cas de conflits, le rebase sera interrompu et vous devrez les résoudre manuellement.',
            },
            'Rebaser',
        );
        if (confirm !== 'Rebaser') {
            return;
        }

        try {
            await gitRebase(gitApi.git.path, targetBranch, repo.rootUri.fsPath);
            await repo.status();
            vscode.window.showInformationMessage(`Rebase de « ${currentBranch} » sur « ${targetBranch} » terminé.`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);

            // git rebase laisse le dépôt en état REBASE_HEAD en cas de conflit.
            // On propose d'abandonner pour remettre le dépôt dans un état propre.
            await offerConflictResolution(repo, gitApi, context);

            const action = await vscode.window.showErrorMessage(
                `Le rebase a échoué (probablement des conflits). Voulez-vous annuler le rebase ?`,
                { detail: message },
                'Annuler le rebase',
            );

            if (action === 'Annuler le rebase') {
                try {
                    await gitRebaseAbort(gitApi.git.path, repo.rootUri.fsPath);
                    await repo.status();
                    vscode.window.showInformationMessage('Rebase annulé. La branche est revenue à son état initial.');
                } catch (abortErr) {
                    vscode.window.showErrorMessage(
                        `Échec de git rebase --abort : ${abortErr instanceof Error ? abortErr.message : abortErr}`,
                    );
                }
            }
        }
    });

    return [rebaseOnto];
}
