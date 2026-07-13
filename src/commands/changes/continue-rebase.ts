import { API } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { runGit } from '../../git/git-exec';
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

async function _spawnGit(gitPath: string, args: string[], cwd: string): Promise<void> {
    // GIT_EDITOR=true évite l'ouverture d'un éditeur interactif pour valider le message
    await runGit(gitPath, args, cwd, { env: { GIT_EDITOR: 'true' } });
}
