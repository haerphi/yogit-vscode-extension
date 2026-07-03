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

        const confirm = await vscode.window.showWarningMessage(
            'Annuler le rebase en cours ?',
            { modal: true, detail: 'La branche reviendra à son état avant le rebase.' },
            'Annuler le rebase',
        );
        if (confirm !== 'Annuler le rebase') {
            return;
        }

        try {
            await _spawnGit(gitApi.git.path, ['rebase', '--abort'], repo.rootUri.fsPath);
            await repo.status();
            vscode.window.showInformationMessage('Rebase annulé — branche revenue à son état initial.');
        } catch (err) {
            vscode.window.showErrorMessage(`Échec de git rebase --abort : ${err instanceof Error ? err.message : err}`);
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
