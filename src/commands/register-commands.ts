import { API } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { BranchesProvider } from '../git/branches-provider';
import { StashProvider } from '../git/stash-provider';
import { registerCopyBranchName } from './branch/copy-branch-name';
import { registerCreateBranch } from './branch/create-branch';
import { registerCreateBranchFrom } from './branch/create-branch-from';
import { registerDeleteBranch } from './branch/delete-branch';
import { registerMerge } from './branch/merge';
import { registerRebase } from './branch/rebase';
import { registerRebaseInteractive } from './branch/rebase-interactive';
import { registerSync } from './branch/sync';
import { registerSwitch } from './branch/switch';
import { registerFileActions } from './changes/file-actions';
import { registerStageHunk } from './changes/stage-hunk';
import { registerStageUnstage } from './changes/stage-unstage';
import { registerStash } from './changes/stash';
import { registerAbortRebase } from './changes/abort-rebase';
import { registerDiscard } from './changes/discard';
import { registerContinueRebase } from './changes/continue-rebase';
import { registerResolveConflict } from './changes/resolve-conflict';
import { registerShowLog } from './log/show-log';
import { registerAddRemote } from './repo/add-remote';
import { registerRepoSetup } from './repo/init-repo';

/**
 * Point d'entrée unique pour l'enregistrement de toutes les commandes de l'extension.
 *
 * Chaque famille de commandes est isolée dans son propre fichier sous src/commands/.
 * Pour ajouter une nouvelle commande :
 *   1. Créer src/commands/<catégorie>/<nom>.ts avec une fonction registerXxx()
 *   2. L'importer ici et l'ajouter au tableau ci-dessous
 *   3. Déclarer la commande dans package.json → contributes.commands (et menus si besoin)
 *
 * extension.ts ne doit pas être modifié pour ajouter des commandes.
 *
 * @param gitApi   - L'API vscode.git (v1), utilisée par toutes les commandes git.
 * @param provider - Le provider de la TreeView, passé aux commandes qui doivent
 *                   forcer un rafraîchissement hors du cycle onDidChange.
 * @param context  - Le contexte d'extension, nécessaire pour les WebviewPanels (modales).
 */
export function registerCommands(
    gitApi: API,
    provider: BranchesProvider,
    stashProvider: StashProvider,
    context: vscode.ExtensionContext,
): vscode.Disposable[] {
    return [
        registerCreateBranch(gitApi, provider),
        registerCreateBranchFrom(gitApi, provider),
        ...registerSwitch(gitApi),
        registerCopyBranchName(),
        ...registerDeleteBranch(gitApi, context),
        ...registerStageUnstage(gitApi),
        ...registerStageHunk(gitApi, context),
        ...registerFileActions(),
        ...registerStash(gitApi, stashProvider, context),
        ...registerSync(gitApi, provider, context),
        ...registerMerge(gitApi, context),
        ...registerRebase(gitApi, context),
        registerRebaseInteractive(gitApi, context),
        registerShowLog(gitApi, context),
        registerResolveConflict(gitApi, context),
        ...registerDiscard(gitApi),
        registerAbortRebase(gitApi),
        registerContinueRebase(gitApi),
        ...registerRepoSetup(gitApi),
        registerAddRemote(gitApi, context),
    ];
}
