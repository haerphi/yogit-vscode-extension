import { API } from '@haerphi/vscode-git-api-types';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { getRepo } from '../utils';

export function registerAbortRebase(gitApi: API): vscode.Disposable {
    return vscode.commands.registerCommand('haerphi-yogit.abort-rebase', async () => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        const abortLabel = vscode.l10n.t('Abort Rebase');
        const confirm = await vscode.window.showWarningMessage(
            vscode.l10n.t('Abort the rebase in progress?'),
            { modal: true, detail: vscode.l10n.t('The branch will return to its state before the rebase.') },
            abortLabel,
        );
        if (confirm !== abortLabel) {
            return;
        }

        try {
            await _spawnGit(gitApi.git.path, ['rebase', '--abort'], repo.rootUri.fsPath);
            await repo.status();
            vscode.window.showInformationMessage(
                vscode.l10n.t('Rebase aborted. The branch is back to its initial state.'),
            );
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('git rebase --abort failed: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });
}

function _spawnGit(gitPath: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = spawn(gitPath, args, { cwd });
        const err: string[] = [];
        proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
        proc.on('close', code => {
            if (code !== 0) {
                reject(new Error(err.join('').trim()));
            } else {
                resolve();
            }
        });
    });
}
