/**
 * Types partagés pour la vue historique (extension host ↔ webview).
 * Ne doit jamais importer `vscode` ni de modules Node.js.
 */

export interface LogRef {
    type: 'head' | 'local' | 'remote' | 'tag';
    /** Nom complet du ref, ex: "main", "origin/main", "v1.0.0" */
    name: string;
    /** Vrai uniquement pour le HEAD local (HEAD -> branchName) */
    isCurrent: boolean;
}

export interface CommitEntry {
    hash: string;
    shortHash: string;
    parentHashes: string[];
    author: string;
    date: string;
    /** ISO 8601 date (e.g. "2024-06-15 10:30:00 +0200") — used for date filtering */
    isoDate: string;
    message: string;
    refs: LogRef[];
}
