import { API } from '@haerphi/vscode-git-api-types';
import { spawn } from 'child_process';
import * as vscode from 'vscode';

function runGit(gitPath: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = spawn(gitPath, args, { cwd });
        const err: string[] = [];
        proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
        proc.on('close', code => {
            if (code !== 0) {
                reject(new Error(err.join('').trim()));
                return;
            }
            resolve();
        });
    });
}

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

    const askRemoteUrl = (title: string): Thenable<string | undefined> =>
        vscode.window.showInputBox({
            title,
            prompt: 'URL du dépôt distant (https ou ssh)',
            placeHolder: 'ex : https://github.com/user/repo.git',
            validateInput: value => (value.trim() ? undefined : "L'URL ne peut pas être vide"),
        });

    const cloneRepo = vscode.commands.registerCommand('haerphi-yogit.clone-repo', async () => {
        const folder = getWorkspaceFolder();
        if (!folder) {
            return;
        }
        // git clone refuse un dossier de destination non vide — vérifier avant
        // de demander l'URL pour donner un message clair immédiatement.
        const entries = await vscode.workspace.fs.readDirectory(folder.uri);
        if (entries.length > 0) {
            vscode.window.showErrorMessage(
                `Impossible de cloner : le dossier « ${folder.name} » n'est pas vide. ` +
                    'Ouvrez un dossier vide, ou utilisez « Lier à un dépôt distant existant » ' +
                    'pour rattacher les fichiers existants à un dépôt distant.',
            );
            return;
        }
        const url = await askRemoteUrl('Cloner un dépôt distant');
        if (!url) {
            return;
        }
        try {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Clonage du dépôt…' },
                async () => {
                    await runGit(gitApi.git.path, ['clone', url.trim(), '.'], folder.uri.fsPath);
                    // Le clone est fait hors API vscode.git — on enregistre explicitement
                    // le dépôt pour que les providers se branchent sans recharger la fenêtre.
                    await gitApi.openRepository(folder.uri);
                },
            );
            vscode.window.showInformationMessage(`Dépôt cloné dans « ${folder.name} ».`);
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Clonage du dépôt échoué : ${errMsg}`);
        }
    });

    const linkRepo = vscode.commands.registerCommand('haerphi-yogit.link-repo', async () => {
        const folder = getWorkspaceFolder();
        if (!folder) {
            return;
        }
        const url = await askRemoteUrl('Lier à un dépôt distant existant');
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
        cloneRepo,
        linkRepo,
        gitApi.onDidChangeState(() => updateContext()),
        gitApi.onDidOpenRepository(() => updateContext()),
        gitApi.onDidCloseRepository(() => updateContext()),
    ];
}
