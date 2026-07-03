import { Repository } from '@haerphi/vscode-git-api-types';
import {
    Disposable,
    Event,
    EventEmitter,
    ProviderResult,
    ThemeIcon,
    TreeDataProvider,
    TreeItem,
    TreeItemCollapsibleState,
} from 'vscode';
import { BranchLeaf } from './branches-provider';

/**
 * Structure discriminée représentant un nœud de la TreeView "remotes".
 *
 * - RemoteGroup : nœud parent portant le nom d'un remote (origin, upstream…).
 * - BranchLeaf  : nœud feuille, même forme que dans la vue branches pour que
 *   les commandes (switch, merge, rebase, delete…) fonctionnent dans les deux vues.
 */
type RemoteGroup = { kind: 'remote'; name: string; fetchUrl?: string };
type RemoteNode = RemoteGroup | BranchLeaf;

/**
 * Provider de données pour la TreeView "remotes" — un groupe par remote configuré,
 * contenant ses branches distantes.
 *
 * Même cycle de vie que BranchesProvider : setRepository() branche le provider
 * sur le dépôt et s'abonne à repo.state.onDidChange pour le rafraîchissement.
 */
export class RemotesProvider implements TreeDataProvider<RemoteNode> {
    private readonly _onDidChangeTreeData = new EventEmitter<void>();
    readonly onDidChangeTreeData: Event<void> = this._onDidChangeTreeData.event;

    private gitRepository: Repository | undefined;
    private repoStateListener: Disposable | undefined;

    setRepository(repository: Repository): void {
        this.repoStateListener?.dispose();

        this.gitRepository = repository;
        this.repoStateListener = repository.state.onDidChange(() => {
            this._onDidChangeTreeData.fire();
        });

        this._onDidChangeTreeData.fire();
    }

    /**
     * Force un re-rendu immédiat. Uniquement pour les opérations faites hors
     * de l'API vscode.git (child_process), qui ne déclenchent pas onDidChange.
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(node: RemoteNode): TreeItem {
        if (node.kind === 'remote') {
            const item = new TreeItem(node.name, TreeItemCollapsibleState.Expanded);
            item.contextValue = 'remote';
            item.iconPath = new ThemeIcon('cloud');
            item.description = node.fetchUrl;
            return item;
        }

        const branch = node.branch;
        if (!branch.name) {
            throw new Error('Branch name is undefined');
        }

        // Le préfixe du remote est déjà porté par le nœud parent — on affiche
        // le nom court, mais branch.name reste complet (ex: "origin/main")
        // pour que les commandes partagées avec la vue branches fonctionnent.
        const item = new TreeItem(branch.name.split('/').slice(1).join('/'));
        item.contextValue = 'branch-remote';
        item.tooltip = branch.name;
        return item;
    }

    getChildren(element?: RemoteNode): ProviderResult<RemoteNode[]> {
        if (!this.gitRepository) {
            return [];
        }

        // Racine : un groupe par remote configuré.
        if (!element) {
            return this.gitRepository.state.remotes.map(remote => ({
                kind: 'remote' as const,
                name: remote.name,
                fetchUrl: remote.fetchUrl,
            }));
        }

        // Enfants d'un remote : ses branches distantes.
        if (element.kind === 'remote') {
            return this.gitRepository
                .getBranches({ remote: true })
                .then(branches =>
                    branches
                        .filter(b => b.name?.startsWith(`${element.name}/`) ?? false)
                        .map(branch => ({ kind: 'branch' as const, branch })),
                );
        }

        // Les feuilles (branches) n'ont pas d'enfants.
        return [];
    }
}
