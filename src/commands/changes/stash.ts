import { API, Status } from '@haerphi/vscode-git-api-types';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseMultiFileDiff } from '../../git/diff-parser';
import { runGit } from '../../git/git-exec';
import { StashEntry, StashProvider } from '../../git/stash-provider';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { DiffPanel } from '../../ui/DiffPanel';
import { getRepo } from '../utils';

/**
 * `-u` inclut le diff des fichiers non trackés inclus dans le stash (3ᵉ parent du
 * commit de stash, s'il existe) — sans effet, sans erreur, si le stash n'en contient pas.
 * `--unified=100000` fournit tout le fichier comme contexte, pour que le bouton
 * "Afficher tout le fichier" de la vue diff fonctionne aussi ici (voir stage-hunk.ts).
 */
function gitStashShow(gitPath: string, ref: string, cwd: string): Promise<string> {
    return runGit(gitPath, ['stash', 'show', '-p', '-u', '--no-color', '--unified=100000', ref], cwd);
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
            vscode.window.showInformationMessage(vscode.l10n.t('No changes to stash.'));
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
            placeHolder: vscode.l10n.t('Select the files to stash'),
            title: vscode.l10n.t('Partial Stash'),
        });

        // undefined = Échap, [] = désélectionné tout puis validé
        if (!selected || selected.length === 0) {
            return;
        }

        const message = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('Stash message (optional)'),
            placeHolder: vscode.l10n.t('WIP: description of the changes'),
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
            vscode.window.showErrorMessage(
                vscode.l10n.t('Could not stash: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });

    /**
     * Aperçu du contenu d'un stash, dans la même vue diff (DiffPanel/yogit-diff) que
     * pour les changements en cours — en lecture seule, car un stash n'est pas modifiable
     * en place. `git stash show -p` peut couvrir plusieurs fichiers ; si c'est le cas,
     * un QuickPick permet de choisir lequel visualiser.
     */
    const stashShow = vscode.commands.registerCommand('haerphi-yogit.stash-show', async (entry: StashEntry) => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        let raw: string;
        try {
            raw = await gitStashShow(gitApi.git.path, entry.ref, repo.rootUri.fsPath);
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t(
                    'Could not read the stash content: {0}',
                    err instanceof Error ? err.message : String(err),
                ),
            );
            return;
        }

        const diffs = parseMultiFileDiff(raw);
        if (diffs.length === 0) {
            vscode.window.showInformationMessage(vscode.l10n.t('No textual change detected in this stash.'));
            return;
        }

        let fileDiff = diffs[0];
        if (diffs.length > 1) {
            const picked = await vscode.window.showQuickPick(
                diffs.map(d => ({
                    label: path.basename(d.filePath),
                    description: path.dirname(d.filePath) === '.' ? '' : path.dirname(d.filePath).replace(/\\/g, '/'),
                    diff: d,
                })),
                { title: entry.message, placeHolder: vscode.l10n.t('Select a file to view its changes') },
            );
            if (!picked) {
                return;
            }
            fileDiff = picked.diff;
        }

        fileDiff.readOnly = true;
        fileDiff.actionLabel = vscode.l10n.t('Stash');
        // Clé de panel distincte du filePath brut pour ne pas entrer en collision avec
        // un panel "Indexer/Désindexer" déjà ouvert sur ce même fichier.
        await DiffPanel.show(context, fileDiff, `stash:${entry.ref}:${fileDiff.filePath}`);
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
                vscode.l10n.t('Could not apply stash: {0}', err instanceof Error ? err.message : String(err)),
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
                vscode.l10n.t('Could not apply stash: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });

    const stashDrop = vscode.commands.registerCommand('haerphi-yogit.stash-drop', async (entry: StashEntry) => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        const result = await ConfirmModal.show(context, {
            title: vscode.l10n.t('Drop Stash'),
            message: vscode.l10n.t('Permanently delete "{0}"?', entry.message),
            warning: vscode.l10n.t('This action is irreversible.'),
            buttons: [
                { label: vscode.l10n.t('Delete'), value: 'confirm', variant: 'danger' },
                { label: vscode.l10n.t('Cancel'), value: 'cancel', variant: 'secondary' },
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
                vscode.l10n.t('Could not drop stash: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });

    return [stashPush, stashShow, stashPop, stashApply, stashDrop];
}
