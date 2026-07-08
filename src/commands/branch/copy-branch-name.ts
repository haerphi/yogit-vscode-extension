import * as vscode from 'vscode';
import { BranchLeaf } from '../../git/branches-provider';

/**
 * Copie le nom de la branche dans le presse-papiers, depuis les vues branches et remotes.
 * Le nom est copié tel qu'affiché par le nœud : court pour une branche locale ("foo"),
 * préfixé du remote pour une branche distante ("origin/foo").
 */
export function registerCopyBranchName(): vscode.Disposable {
    return vscode.commands.registerCommand('haerphi-yogit.copy-branch-name', async (node: BranchLeaf) => {
        const branchName = node.branch.name;
        if (!branchName) {
            return;
        }

        await vscode.env.clipboard.writeText(branchName);
        // Feedback discret : la copie est instantanée, une notification serait intrusive.
        vscode.window.setStatusBarMessage(vscode.l10n.t('Branch name "{0}" copied.', branchName), 3000);
    });
}
