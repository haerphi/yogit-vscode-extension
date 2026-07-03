import { API } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { ChangeLeaf } from '../../git/changes-provider';
import { ConflictPanel } from '../../ui/ConflictPanel';

export function registerResolveConflict(gitApi: API, context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('haerphi-yogit.resolve-conflict', (node: ChangeLeaf) => {
        ConflictPanel.show(context, gitApi, node.change.uri.fsPath);
    });
}
