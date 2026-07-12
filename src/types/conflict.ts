/**
 * Types partagés pour la résolution visuelle des conflits (extension host ↔ webview).
 * Ne doit jamais importer `vscode` ni de modules Node.js.
 */

export interface ConflictHunk {
    id: number;
    /** Lignes du côté HEAD (notre version) */
    currentLines: string[];
    /** Lignes du côté entrant (leur version) */
    theirsLines: string[];
    /** Numéro de ligne (1-based) de la première ligne current dans le fichier en conflit */
    currentStartLine: number;
    /** Numéro de ligne (1-based) de la première ligne theirs dans le fichier en conflit */
    theirsStartLine: number;
    /** Sélection ligne à ligne côté current (true = inclure dans le résultat) */
    currentSelected: boolean[];
    /** Sélection ligne à ligne côté theirs */
    theirsSelected: boolean[];
    /**
     * Ordre de sélection : liste des lignes dans l'ordre où l'utilisateur les a cochées.
     * C'est cette liste qui détermine l'ordre dans le résultat final (pas current-then-theirs).
     */
    selectionOrder: Array<{ side: 'current' | 'theirs'; idx: number }>;
    /** Contenu du résultat final, auto-construit à partir des sélections ou édité librement */
    finalContent: string;
    /** True dès que l'utilisateur a tapé directement dans le textarea — les sélections sont alors ignorées */
    finalEdited: boolean;
    /**
     * True dès que l'utilisateur a fait un choix explicite sur ce hunk (clic ligne,
     * bouton rapide, édition manuelle). Distingue « non résolu » d'« résolu vers un
     * résultat vide » — cas d'un côté vide ou du bouton « Aucun », où aucune ligne
     * n'est sélectionnée mais le conflit est bel et bien tranché.
     */
    touched: boolean;
}

/** Section sans conflit entre deux hunks */
export interface ContextSection {
    type: 'context';
    lines: string[];
    /** Numéro de ligne (1-based) de la première ligne du bloc dans le fichier en conflit */
    startLine: number;
}

export interface ConflictSection {
    type: 'conflict';
    hunk: ConflictHunk;
}

export type FileSection = ContextSection | ConflictSection;

export interface ConflictFile {
    /** Chemin absolu sur disque */
    fsPath: string;
    /** Nom affiché dans l'UI */
    fileName: string;
    sections: FileSection[];
}
