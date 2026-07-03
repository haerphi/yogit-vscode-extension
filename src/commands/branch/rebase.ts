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
            vscode.window.showErrorMessage(vscode.l10n.t('Could not determine the current branch (detached HEAD?)'));
            return;
        }

        const targetBranch = node.branch.name;
        if (!targetBranch) {
            return;
        }

        if (targetBranch === currentBranch) {
            vscode.window.showWarningMessage(vscode.l10n.t('Cannot rebase a branch onto itself.'));
            return;
        }

        const rebaseLabel = vscode.l10n.t('Rebase');
        const confirm = await vscode.window.showWarningMessage(
            vscode.l10n.t('Rebase "{0}" onto "{1}"?', currentBranch, targetBranch),
            {
                modal: true,
                detail: vscode.l10n.t(
                    'The commits of the current branch will be replayed on top of the target. ' +
                        'If conflicts occur, the rebase will stop and you will have to resolve them manually.',
                ),
            },
            rebaseLabel,
        );
        if (confirm !== rebaseLabel) {
            return;
        }

        try {
            await gitRebase(gitApi.git.path, targetBranch, repo.rootUri.fsPath);
            await repo.status();
            vscode.window.showInformationMessage(
                vscode.l10n.t('Rebase of "{0}" onto "{1}" completed.', currentBranch, targetBranch),
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);

            // git rebase laisse le dépôt en état REBASE_HEAD en cas de conflit.
            // On propose d'abandonner pour remettre le dépôt dans un état propre.
            await offerConflictResolution(repo, gitApi, context);

            const abortLabel = vscode.l10n.t('Abort Rebase');
            const action = await vscode.window.showErrorMessage(
                vscode.l10n.t('Rebase failed (likely conflicts). Do you want to abort the rebase?'),
                { detail: message },
                abortLabel,
            );

            if (action === abortLabel) {
                try {
                    await gitRebaseAbort(gitApi.git.path, repo.rootUri.fsPath);
                    await repo.status();
                    vscode.window.showInformationMessage(
                        vscode.l10n.t('Rebase aborted. The branch is back to its initial state.'),
                    );
                } catch (abortErr) {
                    vscode.window.showErrorMessage(
                        vscode.l10n.t(
                            'git rebase --abort failed: {0}',
                            abortErr instanceof Error ? abortErr.message : String(abortErr),
                        ),
                    );
                }
            }
        }
    });

    return [rebaseOnto];
}
