export type DiffLineType = 'context' | 'add' | 'remove';

export interface DiffLine {
    type: DiffLineType;
    content: string;
    index: number; // position 0-based dans le tableau lines du hunk
}

export interface Hunk {
    index: number;
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    contextHint: string; // texte après @@ ... @@ (ex: nom de fonction)
    lines: DiffLine[];
}

export interface FileDiff {
    filePath: string;
    header: string; // lignes "diff --git", "index", "---", "+++"
    hunks: Hunk[];
    actionLabel?: string; // libellé du bouton de validation dans le DiffPanel
    /** Vue seule lecture (ex: contenu d'un stash) — masque les checkboxes et le bouton d'action. */
    readOnly?: boolean;
}

// hunkIndex → 'all' (hunk entier) ou tableau d'indices de lignes sélectionnées
export type HunkSelection = Record<number, 'all' | number[]>;
