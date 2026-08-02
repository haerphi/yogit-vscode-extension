import * as vscode from 'vscode';

/**
 * Contrat minimal attendu d'un provider filtrable (BranchesProvider, RemotesProvider).
 */
export interface FilterableProvider {
    setFilter(value: string): void;
    readonly activeFilter: string;
}

export interface FilterTarget {
    provider: FilterableProvider;
    view: vscode.TreeView<unknown>;
    /** Clé de contexte pilotant l'affichage du bouton « Effacer » et du message d'accueil. */
    contextKey: string;
}

function applyFilter(target: FilterTarget, value: string): void {
    const trimmed = value.trim();

    target.provider.setFilter(trimmed);
    // La description est le seul emplacement où VS Code laisse afficher un état
    // persistant à côté du titre de la vue — c'est ce qui matérialise la recherche active.
    target.view.description = trimmed ? vscode.l10n.t('search: {0}', trimmed) : undefined;
    vscode.commands.executeCommand('setContext', target.contextKey, trimmed.length > 0);
}

/**
 * Ouvre le champ de recherche d'une vue.
 *
 * Le filtre s'applique à chaque frappe (onDidChangeValue) pour un rendu type
 * "barre de recherche" ; Échap restaure le filtre précédent, Entrée le valide.
 */
function promptFilter(target: FilterTarget, placeholder: string): void {
    const input = vscode.window.createInputBox();
    const previous = target.provider.activeFilter;
    let accepted = false;

    input.title = vscode.l10n.t('Search');
    input.placeholder = placeholder;
    input.value = previous;

    input.onDidChangeValue(value => applyFilter(target, value));
    input.onDidAccept(() => {
        accepted = true;
        input.hide();
    });
    input.onDidHide(() => {
        if (!accepted) {
            applyFilter(target, previous);
        }
        input.dispose();
    });

    input.show();
}

/**
 * Recherche dans les vues « Branches » et « Remotes ».
 *
 * VS Code n'autorise pas de champ texte à l'intérieur d'une TreeView : la recherche
 * passe par une InputBox appelée depuis la barre de titre de la vue (ou Ctrl+F quand
 * la vue a le focus), et le filtre reste actif jusqu'à ce qu'il soit effacé.
 */
export function registerBranchFilters(targets: { branches: FilterTarget; remotes: FilterTarget }): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand('haerphi-yogit.filter-branches', () =>
            promptFilter(targets.branches, vscode.l10n.t('Filter local branches…')),
        ),
        vscode.commands.registerCommand('haerphi-yogit.clear-filter-branches', () => applyFilter(targets.branches, '')),
        vscode.commands.registerCommand('haerphi-yogit.filter-remotes', () =>
            promptFilter(targets.remotes, vscode.l10n.t('Filter remote branches…')),
        ),
        vscode.commands.registerCommand('haerphi-yogit.clear-filter-remotes', () => applyFilter(targets.remotes, '')),
    ];
}
