import { API } from '@haerphi/vscode-git-api-types';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { BranchLeaf } from '../../git/branches-provider';
import { offerConflictResolution } from '../../git/conflict-helper';
import { getRepo } from '../utils';

export function registerMerge(gitApi: API, context: vscode.ExtensionContext): vscode.Disposable[] {
    const merge = vscode.commands.registerCommand('haerphi-yogit.merge', async (node: BranchLeaf) => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        const targetBranch = node.branch.name;
        if (!targetBranch) {
            return;
        }

        const currentBranch = repo.state.HEAD?.name ?? '(HEAD détachée)';

        const option = await vscode.window.showQuickPick(
            [
                {
                    label: 'Default',
                    description: 'Fast-forward si possible',
                    args: [] as string[],
                },
                {
                    label: 'No Fast-Forward',
                    description: 'Toujours créer un commit de merge',
                    args: ['--no-ff'],
                },
                {
                    label: 'Squash',
                    description: 'Squash des commits — sans commit automatique',
                    args: ['--squash'],
                },
                {
                    label: "Don't Commit",
                    description: 'Merge sans commit automatique',
                    args: ['--no-commit'],
                },
            ],
            {
                title: `Merger « ${targetBranch} » dans « ${currentBranch} »`,
                placeHolder: 'Choisir le mode de merge…',
            },
        );
        if (!option) {
            return;
        }

        try {
            await _spawnGit(gitApi.git.path, ['merge', ...option.args, targetBranch], repo.rootUri.fsPath);
            await repo.status();
            const needsCommit = option.args.includes('--squash') || option.args.includes('--no-commit');
            const suffix = needsCommit ? ' — pensez à commiter les changements indexés.' : '.';
            vscode.window.showInformationMessage(
                `Merge de « ${targetBranch} » dans « ${currentBranch} » terminé${suffix}`,
            );
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            await offerConflictResolution(repo, gitApi, context);
            const action = await vscode.window.showErrorMessage(
                `Le merge a échoué (conflits probables).`,
                { detail: errMsg, modal: false },
                'Annuler le merge',
            );
            if (action === 'Annuler le merge') {
                try {
                    await _spawnGit(gitApi.git.path, ['merge', '--abort'], repo.rootUri.fsPath);
                    await repo.status();
                    vscode.window.showInformationMessage('Merge annulé — branche revenue à son état initial.');
                } catch {
                    /* ignore */
                }
            }
        }
    });

    return [merge];
}

function _spawnGit(gitPath: string, args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const proc = spawn(gitPath, args, { cwd });
        const out: string[] = [];
        const err: string[] = [];
        proc.stdout.on('data', (d: Buffer) => out.push(d.toString()));
        proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
        proc.on('close', code => {
            if (code !== 0) {
                reject(new Error((err.join('') || out.join('')).trim()));
            } else {
                resolve(out.join(''));
            }
        });
    });
}
