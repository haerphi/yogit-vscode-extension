import { API, Status } from '@haerphi/vscode-git-api-types';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { ChangeLeaf } from '../../git/changes-provider';
import { DiffPanel } from '../../ui/DiffPanel';
import { getRepo } from '../utils';

const UNTRACKED_STATUSES = new Set([Status.UNTRACKED, Status.INTENT_TO_ADD, Status.INTENT_TO_RENAME]);

export function registerDiscard(gitApi: API): vscode.Disposable[] {
    const discardFile = vscode.commands.registerCommand('haerphi-yogit.discard-file', async (node: ChangeLeaf) => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        const fileName = vscode.workspace.asRelativePath(node.change.uri);
        const discardLabel = vscode.l10n.t('Discard Changes');
        const confirm = await vscode.window.showWarningMessage(
            vscode.l10n.t('Discard the changes in "{0}"?', fileName),
            {
                modal: true,
                detail: vscode.l10n.t('This action is irreversible — unsaved changes will be lost.'),
            },
            discardLabel,
        );
        if (confirm !== discardLabel) {
            return;
        }

        try {
            await _closeDiffViews(node.change.uri);
            if (UNTRACKED_STATUSES.has(node.change.status)) {
                fs.unlinkSync(node.change.uri.fsPath);
            } else {
                // Sauvegarder avant git restore pour que le doc soit "propre" :
                // workbench.action.files.revert recharge silencieusement un doc propre,
                // mais affiche une confirmation si le doc a des changements non sauvegardés.
                await _saveIfDirty(node.change.uri);
                await _spawnGit(gitApi.git.path, ['restore', '--', node.change.uri.fsPath], repo.rootUri.fsPath);
                await _reloadEditorFromDisk(node.change.uri);
            }
            await repo.status();
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('Discard failed: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });

    const discardAll = vscode.commands.registerCommand('haerphi-yogit.discard-all', async () => {
        const repo = getRepo(gitApi);
        if (!repo) {
            return;
        }

        const allUnstaged = [...(repo.state.workingTreeChanges ?? []), ...(repo.state.untrackedChanges ?? [])];
        const trackedUris = allUnstaged.filter(c => !UNTRACKED_STATUSES.has(c.status)).map(c => c.uri);
        const untrackedCount = allUnstaged.length - trackedUris.length;

        const detail =
            vscode.l10n.t('This action is irreversible — all unsaved changes will be lost.') +
            (untrackedCount > 0
                ? '\n\n' + vscode.l10n.t('{0} untracked file(s) will also be deleted.', untrackedCount)
                : '');

        const discardAllLabel = vscode.l10n.t('Discard All');
        const confirm = await vscode.window.showWarningMessage(
            vscode.l10n.t('Discard all unstaged changes?'),
            { modal: true, detail },
            discardAllLabel,
        );
        if (confirm !== discardAllLabel) {
            return;
        }

        try {
            // Fermer les vues diff et sauvegarder avant git restore
            await Promise.all(allUnstaged.map(c => _closeDiffViews(c.uri)));
            await Promise.all(trackedUris.map(uri => _saveIfDirty(uri)));

            await _spawnGit(gitApi.git.path, ['restore', '.'], repo.rootUri.fsPath);
            if (untrackedCount > 0) {
                await _spawnGit(gitApi.git.path, ['clean', '-fd'], repo.rootUri.fsPath);
            }

            // Recharger les éditeurs ouverts depuis le disque (séquentiel pour éviter les conflits de focus)
            const prevEditor = vscode.window.activeTextEditor;
            for (const uri of trackedUris) {
                await _reloadEditorFromDisk(uri);
            }
            if (prevEditor) {
                await vscode.window.showTextDocument(prevEditor.document, { preview: false, preserveFocus: false });
            }

            await repo.status();
        } catch (err) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('Discard failed: {0}', err instanceof Error ? err.message : String(err)),
            );
        }
    });

    return [discardFile, discardAll];
}

/**
 * Ferme les vues diff ouvertes pour ce fichier :
 * - Le WebviewPanel "Indexer/Désindexer" (yogit-diff-panel) via DiffPanel.closeForFile
 * - Les onglets TabInputTextDiff éventuels (vues diff natives VS Code)
 */
async function _closeDiffViews(uri: vscode.Uri): Promise<void> {
    // Panel Yogit (stage-hunk) — la clé est le chemin relatif utilisé dans DiffPanel
    DiffPanel.closeForFile(vscode.workspace.asRelativePath(uri));

    // Onglets diff natifs VS Code (git diff standard)
    const tabs: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            if (tab.input instanceof vscode.TabInputTextDiff) {
                const input = tab.input as vscode.TabInputTextDiff;
                if (input.modified.fsPath === uri.fsPath || input.original.fsPath === uri.fsPath) {
                    tabs.push(tab);
                }
            }
        }
    }
    if (tabs.length > 0) {
        await vscode.window.tabGroups.close(tabs);
    }
}

async function _saveIfDirty(uri: vscode.Uri): Promise<void> {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
    if (doc?.isDirty) {
        await doc.save();
    }
}

/**
 * Recharge le fichier dans l'éditeur depuis le disque après git restore.
 *
 * Pré-condition : le doc doit être "propre" (save appelé avant git restore).
 * workbench.action.files.revert est silencieux sur un doc propre — pas de dialogue.
 */
async function _reloadEditorFromDisk(uri: vscode.Uri): Promise<void> {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
    if (!doc) {
        return;
    }
    await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
    await vscode.commands.executeCommand('workbench.action.files.revert');
}

function _spawnGit(gitPath: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = spawn(gitPath, args, { cwd });
        const err: string[] = [];
        proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
        proc.on('close', code => {
            if (code !== 0) {
                reject(new Error(err.join('').trim()));
            } else {
                resolve();
            }
        });
    });
}
