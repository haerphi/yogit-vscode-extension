import { API } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { getRepo } from '../utils';

/**
 * Ajoute un remote au dépôt courant, depuis le bouton + du groupe "Distant"
 * de la TreeView branches.
 */
export function registerAddRemote(gitApi: API, context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('haerphi-yogit.add-remote', async () => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        const result = await ConfirmModal.show(context, {
            title: vscode.l10n.t('Add Remote'),
            message: vscode.l10n.t('Add a remote to the current repository?'),
            inputs: [
                {
                    id: 'name',
                    label: vscode.l10n.t('Remote name'),
                    placeholder: vscode.l10n.t('e.g. origin, upstream'),
                    // "origin" est le nom conventionnel du premier remote uniquement.
                    value: repo.state.remotes.length === 0 ? 'origin' : '',
                },
                {
                    id: 'url',
                    label: vscode.l10n.t('Remote repository URL (https or ssh)'),
                    placeholder: vscode.l10n.t('e.g. https://github.com/user/repo.git'),
                },
            ],
            checkboxes: [{ id: 'fetch', label: vscode.l10n.t('Fetch remote branches after adding'), checked: true }],
            buttons: [
                { label: vscode.l10n.t('Cancel'), value: 'cancel', variant: 'secondary' },
                { label: vscode.l10n.t('Add'), value: 'confirm', variant: 'primary' },
            ],
        });
        if (!result || result.button !== 'confirm') {
            return;
        }

        const name = result.inputs['name']?.trim() ?? '';
        const url = result.inputs['url']?.trim() ?? '';
        if (!name || /\s/.test(name)) {
            vscode.window.showErrorMessage(vscode.l10n.t('The remote name cannot be empty or contain spaces.'));
            return;
        }
        if (!url) {
            vscode.window.showErrorMessage(vscode.l10n.t('The remote URL cannot be empty.'));
            return;
        }
        if (repo.state.remotes.some(r => r.name === name)) {
            vscode.window.showErrorMessage(vscode.l10n.t('The remote "{0}" already exists.', name));
            return;
        }

        try {
            await repo.addRemote(name, url);
            if (result.checkboxes['fetch']) {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: vscode.l10n.t('Fetching "{0}"…', name),
                    },
                    () => repo.fetch(name),
                );
            }
            vscode.window.showInformationMessage(vscode.l10n.t('Remote "{0}" added.', name));
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(vscode.l10n.t('Adding remote failed: {0}', errMsg));
        }
    });
}
