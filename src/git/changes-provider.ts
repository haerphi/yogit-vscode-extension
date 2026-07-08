import { Change, Repository } from '@haerphi/vscode-git-api-types';
import * as fs from 'fs';
import * as path from 'path';
import {
    commands,
    Disposable,
    Event,
    EventEmitter,
    l10n,
    ProviderResult,
    ThemeColor,
    ThemeIcon,
    TreeDataProvider,
    TreeItem,
    TreeItemCollapsibleState,
} from 'vscode';

/**
 * Structure discriminée représentant un nœud de la TreeView "changes".
 *
 * - ChangeGroup : nœud parent "Staged", "Modifications" ou "Conflits" avec le compte affiché.
 * - ChangeLeaf  : nœud feuille correspondant à un fichier modifié.
 *
 * `resourceGroup` sur ChangeLeaf permet aux futures commandes (stage/unstage)
 * de cibler le bon groupe sans inspecter le status du fichier.
 */
type ChangeGroup = { kind: 'group'; label: string; resourceGroup: 'staged' | 'unstaged' | 'conflict' };
export type ChangeLeaf = { kind: 'change'; change: Change; resourceGroup: 'staged' | 'unstaged' | 'conflict' };
type ChangeNode = ChangeGroup | ChangeLeaf;

const STAGED_GROUP: ChangeGroup = { kind: 'group', label: l10n.t('Staged'), resourceGroup: 'staged' };
const UNSTAGED_GROUP: ChangeGroup = { kind: 'group', label: l10n.t('Changes'), resourceGroup: 'unstaged' };
const CONFLICT_GROUP: ChangeGroup = { kind: 'group', label: l10n.t('Conflicts'), resourceGroup: 'conflict' };

/**
 * Provider de données pour la TreeView "changes".
 *
 * Structure :
 *   ─ Staged (N)        ← indexChanges
 *     ├── foo.ts   M
 *     └── bar.ts   A
 *   ─ Modifications (N) ← workingTreeChanges + untrackedChanges
 *     ├── baz.ts   M
 *     └── new.ts   ?
 *
 * `workingTreeChanges` contient les fichiers trackés modifiés/supprimés.
 * `untrackedChanges` est une liste séparée dans l'API — les deux sont fusionnés
 * dans le groupe "Modifications".
 *
 * Le rafraîchissement est automatique via `repo.state.onDidChange`, même mécanisme
 * que BranchesProvider — pas besoin d'appeler refresh() manuellement après une
 * opération passant par l'API vscode.git.
 */
export class ChangesProvider implements TreeDataProvider<ChangeNode> {
    private readonly _onDidChangeTreeData = new EventEmitter<void>();
    readonly onDidChangeTreeData: Event<void> = this._onDidChangeTreeData.event;

    private gitRepository: Repository | undefined;
    private repoStateListener: Disposable | undefined;

    setRepository(repository: Repository): void {
        this.repoStateListener?.dispose();
        this.gitRepository = repository;
        this.repoStateListener = repository.state.onDidChange(() => {
            this._updateRebaseContext();
            this._onDidChangeTreeData.fire();
        });
        this._updateRebaseContext();
        this._onDidChangeTreeData.fire();
    }

    private _updateRebaseContext(): void {
        if (!this.gitRepository) {
            return;
        }
        const rebaseHead = path.join(this.gitRepository.rootUri.fsPath, '.git', 'REBASE_HEAD');
        const inProgress = fs.existsSync(rebaseHead);
        commands.executeCommand('setContext', 'haerphi-yogit.rebaseInProgress', inProgress);
    }

    getTreeItem(node: ChangeNode): TreeItem {
        if (node.kind === 'group') {
            const count = this.countForGroup(node.resourceGroup);
            const item = new TreeItem(
                `${node.label} (${count})`,
                count > 0 ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
            );
            item.contextValue = `group-${node.resourceGroup}`;
            if (node.resourceGroup === 'conflict') {
                item.iconPath = new ThemeIcon('warning', new ThemeColor('list.warningForeground'));
            }
            return item;
        }

        const { change, resourceGroup } = node;
        const fileName = path.basename(change.uri.fsPath);
        const isConflict = resourceGroup === 'conflict';

        const item = new TreeItem(fileName);
        item.resourceUri = change.uri;
        // change-conflict permet de cibler le menu "Résoudre" uniquement sur les fichiers en conflit.
        item.contextValue = isConflict ? 'change-conflict' : `change-${resourceGroup}`;
        // Le chemin relatif (grisé, comme dans la vue SCM native) permet de distinguer
        // les fichiers homonymes (ex: plusieurs package.json dans un monorepo).
        // La lettre de statut n'est pas répétée ici : les décorations git natives
        // (via resourceUri) l'affichent déjà en bout de ligne.
        item.description = this.relativeDir(change.uri.fsPath);
        if (isConflict) {
            item.command = {
                command: 'haerphi-yogit.resolve-conflict',
                title: l10n.t('Resolve Conflict…'),
                arguments: [node],
            };
        } else if (resourceGroup === 'unstaged') {
            item.command = {
                command: 'haerphi-yogit.stage-hunks',
                title: l10n.t('Stage by Hunks/Lines…'),
                arguments: [node],
            };
        } else if (resourceGroup === 'staged') {
            item.command = {
                command: 'haerphi-yogit.unstage-hunks',
                title: l10n.t('Unstage by Hunks/Lines…'),
                arguments: [node],
            };
        }
        // ThemeIcon.File avec resourceUri laisse VS Code choisir l'icône de langage du fichier.
        item.iconPath = ThemeIcon.File;
        item.tooltip = change.uri.fsPath;

        return item;
    }

    getChildren(element?: ChangeNode): ProviderResult<ChangeNode[]> {
        if (!this.gitRepository) {
            return [];
        }

        if (!element) {
            // Le groupe Conflits n'apparaît que s'il y a effectivement des fichiers en
            // conflit à résoudre — pas de section vide à ignorer en permanence.
            return this.countForGroup('conflict') > 0
                ? [CONFLICT_GROUP, STAGED_GROUP, UNSTAGED_GROUP]
                : [STAGED_GROUP, UNSTAGED_GROUP];
        }

        if (element.kind === 'group') {
            const changes = this.changesForGroup(element.resourceGroup);
            return changes.map(change => ({
                kind: 'change' as const,
                change,
                resourceGroup: element.resourceGroup,
            }));
        }

        return [];
    }

    private changesForGroup(group: 'staged' | 'unstaged' | 'conflict'): Change[] {
        if (!this.gitRepository) {
            return [];
        }
        // Les fichiers en conflit (merge, rebase, cherry-pick…) sont exposés par vscode.git
        // dans un tableau dédié, mergeChanges — pas dans indexChanges/workingTreeChanges.
        // C'est ce que la vue SCM native affiche sous "Merge Changes".
        if (group === 'conflict') {
            return this.gitRepository.state.mergeChanges ?? [];
        }

        // workingTreeChanges = fichiers trackés modifiés/supprimés
        // untrackedChanges   = nouveaux fichiers non trackés (propriété ajoutée tardivement
        // dans l'API vscode.git — peut être undefined sur les versions antérieures)
        const staged = this.gitRepository.state.indexChanges ?? [];
        const unstaged = [
            ...(this.gitRepository.state.workingTreeChanges ?? []),
            ...(this.gitRepository.state.untrackedChanges ?? []),
        ];

        // Exclure par précaution les fichiers déjà listés en conflit, au cas où git les
        // ferait aussi apparaître côté index/working tree selon l'état du merge.
        const conflictPaths = new Set((this.gitRepository.state.mergeChanges ?? []).map(c => c.uri.fsPath));
        const source = group === 'staged' ? staged : unstaged;
        return source.filter(c => !conflictPaths.has(c.uri.fsPath));
    }

    private countForGroup(group: 'staged' | 'unstaged' | 'conflict'): number {
        return this.changesForGroup(group).length;
    }

    /**
     * Nombre total de fichiers modifiés (staged + modifications + non trackés + conflits).
     * Utilisé par extension.ts pour le badge de la barre d'activité.
     */
    totalChangesCount(): number {
        return this.countForGroup('staged') + this.countForGroup('unstaged') + this.countForGroup('conflict');
    }

    /**
     * Dossier du fichier relatif à la racine du repo, avec des séparateurs `/`
     * quelle que soit la plateforme. Chaîne vide si le fichier est à la racine.
     */
    private relativeDir(fsPath: string): string {
        if (!this.gitRepository) {
            return '';
        }
        const dir = path.relative(this.gitRepository.rootUri.fsPath, path.dirname(fsPath));
        return dir.split(path.sep).join('/');
    }
}
