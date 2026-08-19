import * as vscode from 'vscode';

const SECTION = 'haerphi-yorgit';

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

/** Sens d'affichage par défaut du rebase interactif au premier chargement (voir yorgit-rebase.ts). */
export function getRebaseDefaultOrder(): RebaseOrder {
    return vscode.workspace.getConfiguration(SECTION).get<RebaseOrder>('rebase.defaultOrder', 'oldest-first');
}

export interface BlameConfig {
    /** Annotation en fin de ligne courante. */
    inline: boolean;
    /** Élément dans la barre d'état. */
    statusBar: boolean;
    /** Délai avant de blâmer une nouvelle ligne, en millisecondes. */
    delay: number;
}

/** Réglages du blame (voir BlameController). */
export function getBlameConfig(): BlameConfig {
    const config = vscode.workspace.getConfiguration(SECTION);
    return {
        inline: config.get<boolean>('blame.inline', true),
        statusBar: config.get<boolean>('blame.statusBar', true),
        delay: config.get<number>('blame.delay', 200),
    };
}
