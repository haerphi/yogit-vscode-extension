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
            vscode.window.showErrorMessage(vscode.l10n.t('No folder open in the workspace.'));
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
                throw new Error(vscode.l10n.t('git init failed without a message.'));
            }
            vscode.window.showInformationMessage(vscode.l10n.t('Git repository initialized in "{0}".', folder.name));
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(vscode.l10n.t('Repository initialization failed: {0}', errMsg));
        }
    });

    const askRemoteUrl = (title: string): Thenable<string | undefined> =>
        vscode.window.showInputBox({
            title,
            prompt: vscode.l10n.t('Remote repository URL (https or ssh)'),
            placeHolder: vscode.l10n.t('e.g. https://github.com/user/repo.git'),
            validateInput: value => (value.trim() ? undefined : vscode.l10n.t('The URL cannot be empty')),
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
                vscode.l10n.t(
                    'Cannot clone: the folder "{0}" is not empty. Open an empty folder, or use "Link to Existing Remote Repository" to attach the existing files to a remote repository.',
                    folder.name,
                ),
            );
            return;
        }
        const url = await askRemoteUrl(vscode.l10n.t('Clone Remote Repository'));
        if (!url) {
            return;
        }
        try {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Cloning repository…') },
                async () => {
                    await runGit(gitApi.git.path, ['clone', url.trim(), '.'], folder.uri.fsPath);
                    // Le clone est fait hors API vscode.git — on enregistre explicitement
                    // le dépôt pour que les providers se branchent sans recharger la fenêtre.
                    await gitApi.openRepository(folder.uri);
                },
            );
            vscode.window.showInformationMessage(vscode.l10n.t('Repository cloned into "{0}".', folder.name));
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(vscode.l10n.t('Repository clone failed: {0}', errMsg));
        }
    });

    const linkRepo = vscode.commands.registerCommand('haerphi-yogit.link-repo', async () => {
        const folder = getWorkspaceFolder();
        if (!folder) {
            return;
        }
        const url = await askRemoteUrl(vscode.l10n.t('Link to Existing Remote Repository'));
        if (!url) {
            return;
        }
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: vscode.l10n.t('Linking to remote repository…'),
                },
                async () => {
                    // Si le dossier n'est pas encore un dépôt, on l'initialise d'abord.
                    const repo = gitApi.repositories[0] ?? (await gitApi.init(folder.uri));
                    if (!repo) {
                        throw new Error(vscode.l10n.t('Repository initialization failed.'));
                    }
                    await repo.addRemote('origin', url.trim());
                    await repo.fetch();
                },
            );
            vscode.window.showInformationMessage(
                vscode.l10n.t(
                    'Repository linked to "origin" and remote references fetched. Switch to a remote branch to get the files.',
                ),
            );
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(vscode.l10n.t('Linking to remote repository failed: {0}', errMsg));
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
