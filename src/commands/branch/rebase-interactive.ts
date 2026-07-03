import { API } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { BranchLeaf } from '../../git/branches-provider';
import { RebasePanel } from '../../ui/RebasePanel';
import { getRepo } from '../utils';

export function registerRebaseInteractive(gitApi: API, context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('haerphi-yogit.rebase-interactive', async (node: BranchLeaf) => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        const targetBranch = node.branch.name;
        if (!targetBranch) {
            return;
        }

        const currentBranch = repo.state.HEAD?.name;
        if (targetBranch === currentBranch) {
            vscode.window.showWarningMessage('Impossible de rebaser une branche sur elle-même.');
            return;
        }

        await RebasePanel.show(context, gitApi, targetBranch, targetBranch);
    });
}
