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
            title: 'Ajouter un remote',
            message: 'Ajouter un dépôt distant au dépôt courant ?',
            inputs: [
                {
                    id: 'name',
                    label: 'Nom du remote',
                    placeholder: 'ex : origin, upstream',
                    // "origin" est le nom conventionnel du premier remote uniquement.
                    value: repo.state.remotes.length === 0 ? 'origin' : '',
                },
                {
                    id: 'url',
                    label: 'URL du dépôt distant (https ou ssh)',
                    placeholder: 'ex : https://github.com/user/repo.git',
                },
            ],
            checkboxes: [
                { id: 'fetch', label: "Récupérer les branches distantes après l'ajout (fetch)", checked: true },
            ],
            buttons: [
                { label: 'Annuler', value: 'cancel', variant: 'secondary' },
                { label: 'Ajouter', value: 'confirm', variant: 'primary' },
            ],
        });
        if (!result || result.button !== 'confirm') {
            return;
        }

        const name = result.inputs['name']?.trim() ?? '';
        const url = result.inputs['url']?.trim() ?? '';
        if (!name || /\s/.test(name)) {
            vscode.window.showErrorMessage('Le nom du remote ne peut pas être vide ni contenir d’espaces.');
            return;
        }
        if (!url) {
            vscode.window.showErrorMessage("L'URL du remote ne peut pas être vide.");
            return;
        }
        if (repo.state.remotes.some(r => r.name === name)) {
            vscode.window.showErrorMessage(`Le remote « ${name} » existe déjà.`);
            return;
        }

        try {
            await repo.addRemote(name, url);
            if (result.checkboxes['fetch']) {
                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: `Fetch de « ${name} »…` },
                    () => repo.fetch(name),
                );
            }
            vscode.window.showInformationMessage(`Remote « ${name} » ajouté.`);
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Ajout du remote échoué : ${errMsg}`);
        }
    });
}
