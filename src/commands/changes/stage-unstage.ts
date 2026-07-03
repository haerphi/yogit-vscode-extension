import { API } from '@haerphi/vscode-git-api-types';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChangeLeaf } from '../../git/changes-provider';
import { DiffPanel } from '../../ui/DiffPanel';
import { getRepo } from '../utils';

/**
 * Enregistre les quatre commandes de staging/unstaging :
 *
 *   - haerphi-yogit.stage-file    → stage un fichier individuel (contextValue: change-unstaged)
 *   - haerphi-yogit.unstage-file  → unstage un fichier individuel (contextValue: change-staged)
 *   - haerphi-yogit.stage-all     → stage tous les fichiers non stagés
 *   - haerphi-yogit.unstage-all   → unstage tous les fichiers stagés
 *
 * repo.add() et repo.revert() de l'API vscode.git opèrent sur des chemins fsPath.
 * repo.status() est appelé après chaque opération car ces commandes passent par
 * child_process/API interne — onDidChange ne se déclenche pas automatiquement sur WSL UNC.
 */
export function registerStageUnstage(gitApi: API): vscode.Disposable[] {
    const stageFile = vscode.commands.registerCommand('haerphi-yogit.stage-file', async (node: ChangeLeaf) => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        try {
            const relPath = path.relative(repo.rootUri.fsPath, node.change.uri.fsPath).replace(/\\/g, '/');
            DiffPanel.closeForFile(relPath);
            await repo.add([node.change.uri.fsPath]);
            await repo.status();
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('Could not stage file: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });

    const unstageFile = vscode.commands.registerCommand('haerphi-yogit.unstage-file', async (node: ChangeLeaf) => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        try {
            const relPath = path.relative(repo.rootUri.fsPath, node.change.uri.fsPath).replace(/\\/g, '/');
            DiffPanel.closeForFile(relPath);
            await repo.revert([node.change.uri.fsPath]);
            await repo.status();
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('Could not unstage file: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });

    const stageAll = vscode.commands.registerCommand('haerphi-yogit.stage-all', async () => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        const paths = [...repo.state.workingTreeChanges, ...(repo.state.untrackedChanges ?? [])].map(c => c.uri.fsPath);

        if (paths.length === 0) {
            return;
        }

        try {
            await repo.add(paths);
            await repo.status();
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('Could not stage all files: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });

    const unstageAll = vscode.commands.registerCommand('haerphi-yogit.unstage-all', async () => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        const changes = repo.state.indexChanges;
        if (changes.length === 0) {
            return;
        }

        try {
            await repo.revert(changes.map(c => c.uri.fsPath));
            await repo.status();
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('Could not unstage all files: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });

    return [stageFile, unstageFile, stageAll, unstageAll];
}
