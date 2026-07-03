import { API } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { LogPanel } from '../../ui/LogPanel';

export function registerShowLog(gitApi: API, context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('haerphi-yogit.show-log', () => {
        LogPanel.show(context, gitApi);
    });
}
