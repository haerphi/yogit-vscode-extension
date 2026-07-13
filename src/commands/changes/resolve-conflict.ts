import { API } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { ChangeLeaf } from '../../git/changes-provider';
import { runGit } from '../../git/git-exec';
import { ConflictPanel } from '../../ui/ConflictPanel';
import { getRepo } from '../utils';

/**
 * Exécute `git checkout --ours|--theirs -- <file>` via child_process.
 *
 * L'API vscode.git n'expose pas la résolution par côté. `--ours` prend le côté
 * `<<<<<<< HEAD` (stage 2), `--theirs` le côté `>>>>>>>` (stage 3) — pour tous les
 * hunks du fichier. Cette convention reste valable en merge comme en rebase et
 * correspond aux labels « HEAD (le nôtre) » / « Entrant (les leurs) » du ConflictPanel.
 *
 * Voir delete-branch.ts / switch.ts pour les raisons du choix de spawn et de gitApi.git.path.
 */
async function gitCheckoutSide(gitPath: string, side: 'ours' | 'theirs', fsPath: string, cwd: string): Promise<void> {
    await runGit(gitPath, ['checkout', `--${side}`, '--', fsPath], cwd);
}

export function registerResolveConflict(gitApi: API, context: vscode.ExtensionContext): vscode.Disposable[] {
    const resolve = vscode.commands.registerCommand('haerphi-yogit.resolve-conflict', (node: ChangeLeaf) => {
        ConflictPanel.show(context, gitApi, node.change.uri.fsPath);
    });

    /**
     * Résout un fichier en conflit en prenant intégralement un seul côté, puis le
     * stage pour marquer le conflit résolu. Opération hors API → repo.status() force
     * la relecture de l'état (le fichier quitte alors mergeChanges).
     */
    const takeSide = (side: 'ours' | 'theirs') => async (node: ChangeLeaf) => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }
        const fsPath = node.change.uri.fsPath;
        try {
            await gitCheckoutSide(gitApi.git.path, side, fsPath, repo.rootUri.fsPath);
            await repo.add([fsPath]);
            await repo.status();
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('Could not resolve conflict: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    };

    const takeOurs = vscode.commands.registerCommand('haerphi-yogit.resolve-conflict-ours', takeSide('ours'));
    const takeTheirs = vscode.commands.registerCommand('haerphi-yogit.resolve-conflict-theirs', takeSide('theirs'));

    return [resolve, takeOurs, takeTheirs];
}
