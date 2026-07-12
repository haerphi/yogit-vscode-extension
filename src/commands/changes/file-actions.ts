import * as path from 'path';
import * as vscode from 'vscode';
import { ChangeLeaf } from '../../git/changes-provider';

/**
 * Actions génériques sur un fichier de la vue "Changes", communes aux trois groupes
 * (Staged / Modifications / Conflits) — d'où l'enregistrement dans un fichier séparé
 * plutôt que dans stage-unstage.ts ou resolve-conflict.ts.
 */
export function registerFileActions(): vscode.Disposable[] {
    const openFile = vscode.commands.registerCommand('haerphi-yogit.open-file', async (node: ChangeLeaf) => {
        await vscode.commands.executeCommand('vscode.open', node.change.uri);
    });

    const copyFileName = vscode.commands.registerCommand('haerphi-yogit.copy-file-name', async (node: ChangeLeaf) => {
        const fileName = path.basename(node.change.uri.fsPath);
        await vscode.env.clipboard.writeText(fileName);
        // Feedback discret : la copie est instantanée, une notification serait intrusive.
        vscode.window.setStatusBarMessage(vscode.l10n.t('File name "{0}" copied.', fileName), 3000);
    });

    return [openFile, copyFileName];
}
