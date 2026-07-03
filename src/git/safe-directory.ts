import { spawn } from 'child_process';
import * as vscode from 'vscode';

/**
 * Détecte l'erreur "dubious ownership" de git sur les chemins UNC WSL
 * (//wsl.localhost/...) et propose à l'utilisateur d'ajouter le dossier
 * à safe.directory pour débloquer l'extension.
 *
 * git refuse d'opérer sur un dépôt dont le propriétaire du dossier diffère
 * de l'utilisateur courant — situation systématique quand VS Code Windows
 * accède à un dépôt Linux via le chemin UNC \\wsl.localhost\...
 */
export async function checkSafeDirectory(gitPath: string): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        return;
    }

    const cwd = folder.uri.fsPath;
    const stderr = await _runGitStatus(gitPath, cwd);
    if (!stderr.includes('dubious ownership')) {
        return;
    }

    // Extraire le chemin suggéré par git (ex: %(prefix)///wsl.localhost/Ubuntu/...)
    const match = stderr.match(/git config --global --add safe\.directory '?([^'\n]+)'?/);
    const safePath = match?.[1] ?? '%(prefix)//' + cwd.replace(/\\/g, '/');

    const action = await vscode.window.showErrorMessage(
        `Git refuse d'accéder à ce dépôt (propriétaire du dossier suspect).`,
        {
            detail: `Le chemin "${cwd}" n'est pas considéré comme sûr par git.\n\nCela arrive sur les dépôts WSL ouverts depuis Windows via \\\\wsl.localhost\\...`,
            modal: true,
        },
        'Marquer comme sûr',
    );

    if (action !== 'Marquer comme sûr') {
        return;
    }

    await _addSafeDirectory(gitPath, safePath);
    vscode.window
        .showInformationMessage(`Dépôt marqué comme sûr. Rechargez la fenêtre pour activer YoGit.`, 'Recharger')
        .then(btn => {
            if (btn === 'Recharger') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        });
}

function _runGitStatus(gitPath: string, cwd: string): Promise<string> {
    return new Promise(resolve => {
        const proc = spawn(gitPath, ['status'], { cwd });
        const err: string[] = [];
        proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
        // Résoudre dans tous les cas — on veut juste lire stderr
        proc.on('close', () => resolve(err.join('')));
        proc.on('error', () => resolve(''));
    });
}

function _addSafeDirectory(gitPath: string, safePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = spawn(gitPath, ['config', '--global', '--add', 'safe.directory', safePath]);
        const err: string[] = [];
        proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
        proc.on('close', code => {
            if (code !== 0) {
                reject(new Error(err.join('').trim() || `git config a échoué (code ${code})`));
            } else {
                resolve();
            }
        });
        proc.on('error', reject);
    });
}
