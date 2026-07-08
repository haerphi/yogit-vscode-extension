import * as vscode from 'vscode';

const SECTION = 'haerphi-yogit';

export type RebaseOrder = 'oldest-first' | 'newest-first';

/**
 * Langue à injecter dans les webviews (panels Lit : rebase, diff, conflits, log, commit).
 *
 * N'affecte PAS `vscode.l10n.t()` (titres de commandes, notifications) : VS Code
 * choisit ce bundle de traduction au démarrage de l'extension d'après sa langue
 * d'affichage globale, avant même que notre code ne s'exécute — aucune API ne permet
 * de le surcharger par extension. "auto" (défaut) suit donc `vscode.env.language`.
 */
export function resolveWebviewLocale(): string {
    const configured = vscode.workspace.getConfiguration(SECTION).get<string>('language', 'auto');
    return configured === 'auto' ? vscode.env.language : configured;
}

/** Sens d'affichage par défaut du rebase interactif au premier chargement (voir yogit-rebase.ts). */
export function getRebaseDefaultOrder(): RebaseOrder {
    return vscode.workspace.getConfiguration(SECTION).get<RebaseOrder>('rebase.defaultOrder', 'oldest-first');
}
