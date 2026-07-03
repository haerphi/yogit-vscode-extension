import { Branch, Repository } from '@haerphi/vscode-git-api-types';
import {
    Disposable,
    Event,
    EventEmitter,
    ProviderResult,
    ThemeColor,
    ThemeIcon,
    TreeDataProvider,
    TreeItem,
} from 'vscode';

/**
 * Nœud feuille de la TreeView "branches" : une branche locale git réelle.
 * Exporté car les commandes le reçoivent en argument via item.command.
 * Les branches distantes sont affichées par la vue "remotes" (RemotesProvider),
 * qui produit des feuilles de même forme pour partager les commandes.
 */
export type BranchLeaf = { kind: 'branch'; branch: Branch };

/**
 * Provider de données pour la TreeView "branches" — liste plate des branches locales.
 *
 * Cycle de vie :
 *   - extension.ts appelle setRepository() dès qu'un dépôt git est détecté.
 *   - Le provider s'abonne à repo.state.onDidChange pour se rafraîchir automatiquement
 *     chaque fois que git signale un changement d'état (HEAD, index, fichiers suivis…).
 *   - Les commandes qui opèrent via l'API vscode.git n'ont pas besoin d'appeler refresh()
 *     manuellement : repo.status() déclenche onDidChange, qui déclenche onDidChangeTreeData.
 *   - Les commandes qui opèrent via child_process (hors API) doivent appeler refresh()
 *     explicitement car elles ne passent pas par le cycle d'état de vscode.git.
 */
export class BranchesProvider implements TreeDataProvider<BranchLeaf> {
    private readonly _onDidChangeTreeData = new EventEmitter<void>();
    readonly onDidChangeTreeData: Event<void> = this._onDidChangeTreeData.event;

    private gitRepository: Repository | undefined;

    // Référence au listener d'état du dépôt courant, pour pouvoir le disposer
    // proprement si setRepository() est appelé une seconde fois (changement de dépôt).
    private repoStateListener: Disposable | undefined;

    /**
     * Branche le provider sur un dépôt git.
     * Dispose l'ancien listener avant d'en créer un nouveau pour éviter les fuites mémoire.
     */
    setRepository(repository: Repository): void {
        this.repoStateListener?.dispose();

        this.gitRepository = repository;

        // Tout changement d'état git (HEAD, index, worktree…) déclenche un re-rendu
        // de la TreeView. C'est ce listener qui met à jour l'icône de la branche courante.
        this.repoStateListener = repository.state.onDidChange(() => {
            this._onDidChangeTreeData.fire();
        });

        this._onDidChangeTreeData.fire();
    }

    /**
     * Force un re-rendu immédiat de toute la TreeView.
     * À utiliser uniquement pour les opérations faites hors de l'API vscode.git
     * (ex: child_process.spawn), car elles ne déclenchent pas onDidChange.
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(node: BranchLeaf): TreeItem {
        const branch = node.branch;
        if (!branch.name) {
            throw new Error('Branch name is undefined');
        }

        // La branche est "actuelle" si son nom correspond au HEAD détaché ou à la branche checkout.
        const isCurrent = branch.name === this.gitRepository?.state.HEAD?.name;

        const item = new TreeItem(branch.name);

        // 'branch-local-current' permet de cibler Pull/Push uniquement sur la branche active.
        // Les when =~ /^branch-local/ et =~ /^branch/ matchent les deux variantes.
        item.contextValue = isCurrent ? 'branch-local-current' : 'branch-local';

        if (isCurrent) {
            // $(pass-filled) : cercle coloré plein, clairement distinct de la flèche de repliage $(chevron-right).
            item.iconPath = new ThemeIcon('pass-filled', new ThemeColor('list.highlightForeground'));
            item.description = 'actuelle';
        }

        return item;
    }

    getChildren(element?: BranchLeaf): ProviderResult<BranchLeaf[]> {
        if (!this.gitRepository) {
            return [];
        }

        // Racine de l'arbre : les branches locales, à plat.
        if (!element) {
            return this.gitRepository
                .getBranches({ remote: false })
                .then(branches => branches.map(branch => ({ kind: 'branch' as const, branch })));
        }

        // Les feuilles (branches) n'ont pas d'enfants.
        return [];
    }
}
