import { API } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { BranchesProvider } from '../../git/branches-provider';
import { getRepo } from '../utils';

async function withProgress(title: string, task: () => Promise<void>): Promise<void> {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `YoGit: ${title}` }, task);
}

export function registerSync(gitApi: API, provider: BranchesProvider): vscode.Disposable[] {
    const fetch = vscode.commands.registerCommand('haerphi-yogit.fetch', async () => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }
        try {
            await withProgress('Fetch…', () => repo.fetch());
            provider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`Fetch échoué : ${err instanceof Error ? err.message : err}`);
        }
    });

    const pull = vscode.commands.registerCommand('haerphi-yogit.pull', async () => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }
        if (!repo.state.HEAD?.upstream) {
            vscode.window.showErrorMessage("La branche courante n'a pas de branche distante configurée.");
            return;
        }
        try {
            await withProgress('Pull…', () => repo.pull());
        } catch (err) {
            vscode.window.showErrorMessage(`Pull échoué : ${err instanceof Error ? err.message : err}`);
        }
    });

    const push = vscode.commands.registerCommand('haerphi-yogit.push', async () => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }
        const head = repo.state.HEAD;
        if (!head?.name) {
            vscode.window.showErrorMessage('Aucune branche active.');
            return;
        }
        try {
            if (!head.upstream) {
                // Pas d'upstream : déterminer le remote cible
                const remotes = repo.state.remotes;
                if (remotes.length === 0) {
                    vscode.window.showErrorMessage('Aucun dépôt distant configuré.');
                    return;
                }
                let remoteName: string;
                if (remotes.length === 1) {
                    remoteName = remotes[0].name;
                } else if (remotes.some(r => r.name === 'origin')) {
                    remoteName = 'origin';
                } else {
                    const picked = await vscode.window.showQuickPick(
                        remotes.map(r => r.name),
                        { placeHolder: 'Choisir le dépôt distant' },
                    );
                    if (!picked) {
                        return;
                    }
                    remoteName = picked;
                }
                await withProgress('Push (set upstream)…', () => repo.push(remoteName, head.name!, true));
            } else {
                await withProgress('Push…', () => repo.push());
            }
            provider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`Push échoué : ${err instanceof Error ? err.message : err}`);
        }
    });

    return [fetch, pull, push];
}
