import { API } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { BranchLeaf } from '../../git/branches-provider';
import { offerConflictResolution } from '../../git/conflict-helper';
import { runGit } from '../../git/git-exec';
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

        const currentBranch = repo.state.HEAD?.name ?? vscode.l10n.t('(detached HEAD)');

        const option = await vscode.window.showQuickPick(
            [
                {
                    label: 'Default',
                    description: vscode.l10n.t('Fast-forward when possible'),
                    args: [] as string[],
                },
                {
                    label: 'No Fast-Forward',
                    description: vscode.l10n.t('Always create a merge commit'),
                    args: ['--no-ff'],
                },
                {
                    label: 'Squash',
                    description: vscode.l10n.t('Squash commits — no automatic commit'),
                    args: ['--squash'],
                },
                {
                    label: "Don't Commit",
                    description: vscode.l10n.t('Merge without automatic commit'),
                    args: ['--no-commit'],
                },
            ],
            {
                title: vscode.l10n.t('Merge "{0}" into "{1}"', targetBranch, currentBranch),
                placeHolder: vscode.l10n.t('Choose merge mode…'),
            },
        );
        if (!option) {
            return;
        }

        try {
            await _spawnGit(gitApi.git.path, ['merge', ...option.args, targetBranch], repo.rootUri.fsPath);
            await repo.status();
            const needsCommit = option.args.includes('--squash') || option.args.includes('--no-commit');
            vscode.window.showInformationMessage(
                needsCommit
                    ? vscode.l10n.t(
                          'Merge of "{0}" into "{1}" completed — remember to commit the staged changes.',
                          targetBranch,
                          currentBranch,
                      )
                    : vscode.l10n.t('Merge of "{0}" into "{1}" completed.', targetBranch, currentBranch),
            );
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            await offerConflictResolution(repo, gitApi, context);
            const abortLabel = vscode.l10n.t('Abort Merge');
            const action = await vscode.window.showErrorMessage(
                vscode.l10n.t('Merge failed (likely conflicts).'),
                { detail: errMsg, modal: false },
                abortLabel,
            );
            if (action === abortLabel) {
                try {
                    await _spawnGit(gitApi.git.path, ['merge', '--abort'], repo.rootUri.fsPath);
                    await repo.status();
                    vscode.window.showInformationMessage(
                        vscode.l10n.t('Merge aborted — branch restored to its initial state.'),
                    );
                } catch {
                    /* ignore */
                }
            }
        }
    });

    return [merge];
}

function _spawnGit(gitPath: string, args: string[], cwd: string): Promise<string> {
    return runGit(gitPath, args, cwd);
}
