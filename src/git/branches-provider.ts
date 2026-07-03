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
    TreeItemCollapsibleState,
} from 'vscode';

/**
 * Structure discriminée représentant un nœud de la TreeView.
 *
 * - BranchGroup : nœud parent "Local" ou "Distant" (non cliquable, pas de menu contextuel).
 * - BranchLeaf  : nœud feuille correspondant à une branche git réelle.
 *
 * Le champ `kind` permet de distinguer les deux sans instanceof ni cast.
 * BranchLeaf est exporté car les commandes le reçoivent en argument via item.command.
 */
type BranchGroup = { kind: 'group'; label: string; remote: boolean };
export type BranchLeaf = { kind: 'branch'; branch: Branch };
type BranchNode = BranchGroup | BranchLeaf;

const LOCAL_GROUP: BranchGroup = { kind: 'group', label: 'Local', remote: false };
const REMOTE_GROUP: BranchGroup = { kind: 'group', label: 'Distant', remote: true };

/**
 * Provider de données pour la TreeView "branches".
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
export class BranchesProvider implements TreeDataProvider<BranchNode> {
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

    getTreeItem(node: BranchNode): TreeItem {
        if (node.kind === 'group') {
            return new TreeItem(node.label, TreeItemCollapsibleState.Expanded);
        }

        const branch = node.branch;
        if (!branch.name) {
            throw new Error('Branch name is undefined');
        }

        // La branche est "actuelle" si son nom correspond au HEAD détaché ou à la branche checkout.
        const isCurrent = branch.name === this.gitRepository?.state.HEAD?.name;

        const item = new TreeItem(branch.name);

        // 'branch-local-current' permet de cibler Pull/Push uniquement sur la branche active.
        // 'branch-remote' et 'branch-local' pour les autres cas.
        // Les when =~ /^branch-local/ et =~ /^branch/ matchent les deux variantes locales.
        item.contextValue = branch.remote ? 'branch-remote' : isCurrent ? 'branch-local-current' : 'branch-local';

        if (isCurrent) {
            // $(pass-filled) : cercle coloré plein, clairement distinct de la flèche de repliage $(chevron-right).
            item.iconPath = new ThemeIcon('pass-filled', new ThemeColor('list.highlightForeground'));
            item.description = 'actuelle';
        }

        return item;
    }

    getChildren(element?: BranchNode): ProviderResult<BranchNode[]> {
        if (!this.gitRepository) {
            return [];
        }

        // Racine de l'arbre : on retourne les deux groupes fixes.
        if (!element) {
            return [LOCAL_GROUP, REMOTE_GROUP];
        }

        // Enfants d'un groupe : on récupère les branches via l'API et on les enveloppe
        // dans un BranchLeaf pour que getTreeItem() puisse les discriminer.
        if (element.kind === 'group') {
            return this.gitRepository.getBranches({ remote: element.remote }).then(branches =>
                branches
                    // Les vraies branches distantes ont toujours un "/" dans leur nom
                    // (ex: "origin/main"). Sans ce filtre, l'API retourne aussi les
                    // branches locales qui ont un remote tracking configuré.
                    .filter(b => !element.remote || (b.name?.includes('/') ?? false))
                    .map(branch => ({ kind: 'branch' as const, branch })),
            );
        }

        // Les feuilles (branches) n'ont pas d'enfants.
        return [];
    }
}
