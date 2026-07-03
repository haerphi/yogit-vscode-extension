import { API } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';

/**
 * Détection de l'absence de dépôt git + commandes d'initialisation.
 *
 * Le contexte 'haerphi-yogit.noRepo' pilote les viewsWelcome déclarées dans
 * package.json : quand aucun dépôt n'est détecté, les vues proposent
 * d'initialiser le dossier ou de le lier à un dépôt distant existant.
 */
export function registerRepoSetup(gitApi: API): vscode.Disposable[] {
    const updateContext = () => {
        // Tant que vscode.git n'a pas fini son scan initial (state 'uninitialized'),
        // on ne montre pas l'écran "pas de dépôt" pour éviter un flash au démarrage.
        const noRepo = gitApi.state === 'initialized' && gitApi.repositories.length === 0;
        vscode.commands.executeCommand('setContext', 'haerphi-yogit.noRepo', noRepo);
    };
    updateContext();

    const getWorkspaceFolder = (): vscode.WorkspaceFolder | undefined => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            vscode.window.showErrorMessage("Aucun dossier ouvert dans l'espace de travail.");
        }
        return folder;
    };

    const initRepo = vscode.commands.registerCommand('haerphi-yogit.init-repo', async () => {
        const folder = getWorkspaceFolder();
        if (!folder) {
            return;
        }
        try {
            const repo = await gitApi.init(folder.uri);
            if (!repo) {
                throw new Error('git init a échoué sans message.');
            }
            vscode.window.showInformationMessage(`Dépôt git initialisé dans « ${folder.name} ».`);
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Initialisation du dépôt échouée : ${errMsg}`);
        }
    });

    const linkRepo = vscode.commands.registerCommand('haerphi-yogit.link-repo', async () => {
        const folder = getWorkspaceFolder();
        if (!folder) {
            return;
        }
        const url = await vscode.window.showInputBox({
            title: 'Lier à un dépôt distant existant',
            prompt: 'URL du dépôt distant (https ou ssh)',
            placeHolder: 'ex : https://github.com/user/repo.git',
            validateInput: value => (value.trim() ? undefined : "L'URL ne peut pas être vide"),
        });
        if (!url) {
            return;
        }
        try {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Liaison au dépôt distant…' },
                async () => {
                    // Si le dossier n'est pas encore un dépôt, on l'initialise d'abord.
                    const repo = gitApi.repositories[0] ?? (await gitApi.init(folder.uri));
                    if (!repo) {
                        throw new Error("L'initialisation du dépôt a échoué.");
                    }
                    await repo.addRemote('origin', url.trim());
                    await repo.fetch();
                },
            );
            vscode.window.showInformationMessage(
                'Dépôt lié à « origin » et références distantes récupérées. ' +
                    'Basculez sur une branche distante pour récupérer les fichiers.',
            );
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Liaison au dépôt distant échouée : ${errMsg}`);
        }
    });

    return [
        initRepo,
        linkRepo,
        gitApi.onDidChangeState(() => updateContext()),
        gitApi.onDidOpenRepository(() => updateContext()),
        gitApi.onDidCloseRepository(() => updateContext()),
    ];
}
