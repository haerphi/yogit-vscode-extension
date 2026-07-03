import { API } from '@haerphi/vscode-git-api-types';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { getRepo } from '../utils';

export function registerContinueRebase(gitApi: API): vscode.Disposable {
    return vscode.commands.registerCommand('haerphi-yogit.continue-rebase', async () => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        try {
            await _spawnGit(gitApi.git.path, ['rebase', '--continue'], repo.rootUri.fsPath);
            await repo.status();
            vscode.window.showInformationMessage(vscode.l10n.t('Rebase continued.'));
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('git rebase --continue failed: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });
}

function _spawnGit(gitPath: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
        // GIT_EDITOR=true évite l'ouverture d'un éditeur interactif pour valider le message
        const proc = spawn(gitPath, args, { cwd, env: { ...process.env, GIT_EDITOR: 'true' } });
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
