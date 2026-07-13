import { GitExtension } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { registerCommands } from './commands/register-commands';
import { BranchesProvider } from './git/branches-provider';
import { ChangesProvider } from './git/changes-provider';
import { RemotesProvider } from './git/remotes-provider';
import { getGitOutputChannel } from './git/git-exec';
import { checkSafeDirectory } from './git/safe-directory';
import { StashProvider } from './git/stash-provider';
import { CommitView } from './ui/CommitView';

/**
 * Point d'entrée de l'extension. VS Code appelle cette fonction dès que la vue
 * "branches" est ouverte (voir activationEvents dans package.json).
 *
 * Responsabilités :
 *   1. Créer toutes les TreeViews et leurs providers AVANT toute opération async,
 *      pour que VS Code ait toujours un data provider enregistré même si git n'est pas prêt.
 *   2. Résoudre l'API vscode.git et brancher les providers sur le premier dépôt trouvé.
 *   3. Déléguer l'enregistrement de toutes les commandes à registerCommands().
 *
 * Tout ce qui est poussé dans context.subscriptions est automatiquement disposé
 * à la désactivation de l'extension.
 */
export async function activate(context: vscode.ExtensionContext) {
    const branchesProvider = new BranchesProvider();
    const remotesProvider = new RemotesProvider();
    const changesProvider = new ChangesProvider();
    const stashProvider = new StashProvider();
    // CommitView est un WebviewViewProvider (sidebar) — résolu lazily à la première révélation
    const commitView = new CommitView(context);

    // Les TreeViews sont enregistrées immédiatement — si on attendait la résolution de
    // l'API git, VS Code afficherait "no data provider registered" pendant ce délai.
    const branchesView = vscode.window.createTreeView('branches', { treeDataProvider: branchesProvider });
    const remotesView = vscode.window.createTreeView('remotes', { treeDataProvider: remotesProvider });
    const changesView = vscode.window.createTreeView('changes', { treeDataProvider: changesProvider });
    const stashView = vscode.window.createTreeView('stash', { treeDataProvider: stashProvider });
    const commitViewDisposable = vscode.window.registerWebviewViewProvider('commit', commitView, {
        webviewOptions: { retainContextWhenHidden: true },
    });

    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!gitExtension) {
        vscode.window.showErrorMessage(vscode.l10n.t('Git is not installed'));
        context.subscriptions.push(branchesView, remotesView, changesView, stashView, commitViewDisposable);
        return;
    }

    // Si vscode.git n'est pas encore actif (ex: démarrage lent), on l'attend
    // avant d'accéder à ses exports pour éviter un crash sur undefined.
    const gitExports = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
    const gitApi = gitExports.getAPI(1);

    // Branche les providers sur le premier dépôt disponible.
    // On écoute aussi onDidOpenRepository pour le cas où l'extension s'active
    // avant que git ait détecté le dépôt (ex: ouverture d'un dossier vide puis clone).
    const init = () => {
        if (gitApi.repositories.length > 0) {
            const repo = gitApi.repositories[0];
            branchesProvider.setRepository(repo);
            remotesProvider.setRepository(repo);
            changesProvider.setRepository(repo);
            stashProvider.setRepository(repo, gitApi.git.path);
            commitView.setRepository(repo, gitApi.git.path);
        }
    };

    init();

    // Si aucun dépôt n'est détecté, vérifier si git refuse à cause de "dubious ownership"
    // (chemin UNC WSL \\wsl.localhost\...) et proposer d'ajouter safe.directory.
    if (gitApi.repositories.length === 0) {
        checkSafeDirectory(gitApi.git.path).catch(() => undefined);
    }

    const disposableRepo = gitApi.onDidOpenRepository(() => init());

    // Le badge posé sur la vue "changes" est agrégé par VS Code sur l'icône du
    // conteneur dans la barre d'activité — même mécanisme que le compteur SCM natif.
    const updateBadge = () => {
        const count = changesProvider.totalChangesCount();
        changesView.badge =
            count > 0 ? { value: count, tooltip: vscode.l10n.t('{0} modified file(s)', count) } : undefined;
    };
    const disposableBadge = changesProvider.onDidChangeTreeData(updateBadge);
    updateBadge();

    // Les file watchers ne fonctionnent pas sur les chemins UNC WSL (\\wsl.localhost\...).
    // On force repo.status() à chaque sauvegarde pour que workingTreeChanges soit à jour,
    // ce qui déclenche onDidChange avec l'état réel.
    const disposableSave = vscode.workspace.onDidSaveTextDocument(() => {
        const repo = gitApi.repositories[0];
        if (repo) {
            repo.status().catch(() => undefined);
        }
    });

    context.subscriptions.push(
        getGitOutputChannel(),
        branchesView,
        remotesView,
        changesView,
        stashView,
        commitViewDisposable,
        disposableRepo,
        disposableBadge,
        disposableSave,
        ...registerCommands(gitApi, branchesProvider, stashProvider, context),
    );
}

export function deactivate() {}
