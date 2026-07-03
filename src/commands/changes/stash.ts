import { API, Status } from '@haerphi/vscode-git-api-types';
import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { StashEntry, StashProvider } from '../../git/stash-provider';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { getRepo } from '../utils';

function runGit(gitPath: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = spawn(gitPath, args, { cwd });
        const err: string[] = [];
        proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
        proc.on('close', code => (code === 0 ? resolve() : reject(new Error(err.join('').trim()))));
    });
}

export function registerStash(
    gitApi: API,
    stashProvider: StashProvider,
    context: vscode.ExtensionContext,
): vscode.Disposable[] {
    const stashPush = vscode.commands.registerCommand('haerphi-yogit.stash', async () => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        const cwd = repo.rootUri.fsPath;

        // Dédupliquer : un même fichier peut apparaître dans indexChanges ET workingTreeChanges
        const seen = new Set<string>();
        const allChanges = [
            ...repo.state.indexChanges,
            ...repo.state.workingTreeChanges,
            ...(repo.state.untrackedChanges ?? []),
        ].filter(c => {
            if (seen.has(c.uri.fsPath)) {
                return false;
            }
            seen.add(c.uri.fsPath);
            return true;
        });

        if (allChanges.length === 0) {
            vscode.window.showInformationMessage('Aucun changement à mettre de côté.');
            return;
        }

        const items = allChanges.map(c => {
            const rel = path.relative(cwd, c.uri.fsPath);
            const dir = path.dirname(rel);
            return {
                label: path.basename(c.uri.fsPath),
                description: dir === '.' ? '' : dir.replace(/\\/g, '/'),
                picked: true,
                fsPath: c.uri.fsPath,
                isUntracked: c.status === Status.UNTRACKED,
            };
        });

        const selected = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: 'Sélectionner les fichiers à mettre de côté',
            title: 'Stash partiel',
        });

        // undefined = Échap, [] = désélectionné tout puis validé
        if (!selected || selected.length === 0) {
            return;
        }

        const message = await vscode.window.showInputBox({
            prompt: 'Message du stash (optionnel)',
            placeHolder: 'WIP: description des changements',
        });

        if (message === undefined) {
            return; // Annulé via Échap
        }

        const args = ['stash', 'push'];
        if (message.trim()) {
            args.push('--message', message.trim());
        }
        if (selected.some(item => item.isUntracked)) {
            args.push('--include-untracked');
        }
        args.push('--');
        for (const item of selected) {
            args.push(path.relative(cwd, item.fsPath).replace(/\\/g, '/'));
        }

        try {
            await runGit(gitApi.git.path, args, cwd);
            await repo.status();
            stashProvider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`Impossible de stasher : ${err instanceof Error ? err.message : err}`);
        }
    });

    const stashPop = vscode.commands.registerCommand('haerphi-yogit.stash-pop', async (entry: StashEntry) => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }
        try {
            await runGit(gitApi.git.path, ['stash', 'pop', '--index', entry.ref], repo.rootUri.fsPath);
            await repo.status();
            stashProvider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(
                `Impossible d'appliquer le stash : ${err instanceof Error ? err.message : err}`,
            );
        }
    });

    const stashApply = vscode.commands.registerCommand('haerphi-yogit.stash-apply', async (entry: StashEntry) => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }
        try {
            await runGit(gitApi.git.path, ['stash', 'apply', '--index', entry.ref], repo.rootUri.fsPath);
            await repo.status();
        } catch (err) {
            vscode.window.showErrorMessage(
                `Impossible d'appliquer le stash : ${err instanceof Error ? err.message : err}`,
            );
        }
    });

    const stashDrop = vscode.commands.registerCommand('haerphi-yogit.stash-drop', async (entry: StashEntry) => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        const result = await ConfirmModal.show(context, {
            title: 'Supprimer le stash',
            message: `Supprimer définitivement « ${entry.message} » ?`,
            warning: 'Cette action est irréversible.',
            buttons: [
                { label: 'Supprimer', value: 'confirm', variant: 'danger' },
                { label: 'Annuler', value: 'cancel', variant: 'secondary' },
            ],
        });

        if (!result || result.button !== 'confirm') {
            return;
        }

        try {
            await runGit(gitApi.git.path, ['stash', 'drop', entry.ref], repo.rootUri.fsPath);
            stashProvider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(
                `Impossible de supprimer le stash : ${err instanceof Error ? err.message : err}`,
            );
        }
    });

    return [stashPush, stashPop, stashApply, stashDrop];
}
