import { Repository } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { ConflictPanel } from '../ui/ConflictPanel';
import { API } from '@haerphi/vscode-git-api-types';

/**
 * Après un rebase/merge échoué : appelle repo.status() pour mettre à jour
 * mergeChanges, puis propose d'ouvrir le ConflictPanel sur le premier fichier
 * en conflit si des fichiers sont détectés.
 */
export async function offerConflictResolution(
    repo: Repository,
    gitApi: API,
    context: vscode.ExtensionContext,
): Promise<void> {
    await repo.status();
    const conflicted = repo.state.mergeChanges;
    if (conflicted.length === 0) {
        return;
    }

    const label = conflicted.length === 1 ? `1 fichier en conflit` : `${conflicted.length} fichiers en conflit`;

    const action = await vscode.window.showWarningMessage(
        `${label} — résolvez-les avant de continuer.`,
        'Résoudre les conflits',
    );

    if (action === 'Résoudre les conflits') {
        ConflictPanel.show(context, gitApi, conflicted[0].uri.fsPath);
    }
}
