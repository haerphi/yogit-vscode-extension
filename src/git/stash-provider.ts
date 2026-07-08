import { Repository } from '@haerphi/vscode-git-api-types';
import { spawn } from 'child_process';
import {
    Disposable,
    Event,
    EventEmitter,
    l10n,
    ProviderResult,
    ThemeIcon,
    TreeDataProvider,
    TreeItem,
    TreeItemCollapsibleState,
} from 'vscode';

export interface StashEntry {
    kind: 'stash';
    ref: string; // "stash@{0}"
    message: string; // "On main: WIP description"
    date: string; // "2 hours ago"
}

/**
 * Provider de données pour la TreeView "stash".
 *
 * Charge la liste via `git stash list` (child_process) car l'API vscode.git
 * n'expose pas les stashes. Le rafraîchissement se fait :
 *   - automatiquement via repo.state.onDidChange (couvre les cas où vscode.git
 *     détecte un changement d'état, ex : après repo.status())
 *   - explicitement via refresh() pour les opérations stash/pop/drop qui passent
 *     par child_process et ne déclenchent pas onDidChange
 */
export class StashProvider implements TreeDataProvider<StashEntry> {
    private readonly _onDidChangeTreeData = new EventEmitter<void>();
    readonly onDidChangeTreeData: Event<void> = this._onDidChangeTreeData.event;

    private gitRepository: Repository | undefined;
    private repoStateListener: Disposable | undefined;
    // gitPath n'est connu qu'après résolution de l'API git
    private gitPath = '';

    setRepository(repository: Repository, gitPath: string): void {
        this.repoStateListener?.dispose();
        this.gitRepository = repository;
        this.gitPath = gitPath;
        this.repoStateListener = repository.state.onDidChange(() => {
            this._onDidChangeTreeData.fire();
        });
        this._onDidChangeTreeData.fire();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(entry: StashEntry): TreeItem {
        const item = new TreeItem(entry.message, TreeItemCollapsibleState.None);
        item.description = entry.date;
        item.tooltip = entry.ref;
        item.contextValue = 'stash-entry';
        item.iconPath = new ThemeIcon('archive');
        // Clic gauche → aperçu du contenu du stash, dans la même vue diff que "Changes".
        item.command = {
            command: 'haerphi-yogit.stash-show',
            title: l10n.t('View Changes…'),
            arguments: [entry],
        };
        return item;
    }

    getChildren(): ProviderResult<StashEntry[]> {
        if (!this.gitRepository || !this.gitPath) {
            return [];
        }
        return this.loadStashes();
    }

    private loadStashes(): Promise<StashEntry[]> {
        return new Promise(resolve => {
            if (!this.gitRepository) {
                resolve([]);
                return;
            }
            const proc = spawn(this.gitPath, ['stash', 'list', '--format=%gd|||%s|||%cr'], {
                cwd: this.gitRepository.rootUri.fsPath,
            });
            const out: string[] = [];
            proc.stdout.on('data', (d: Buffer) => out.push(d.toString()));
            proc.on('close', () => {
                const entries = out
                    .join('')
                    .split('\n')
                    .filter(l => l.includes('|||'))
                    .map(line => {
                        const [ref, message, date] = line.split('|||');
                        return {
                            kind: 'stash' as const,
                            ref: ref.trim(),
                            message: message.trim(),
                            date: date.trim(),
                        };
                    });
                resolve(entries);
            });
        });
    }
}
