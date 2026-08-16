/**
 * Types partagés pour le rebase interactif (extension host ↔ webview).
 * Ne doit jamais importer `vscode` ni de modules Node.js.
 */

export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';

export interface RebaseEntry {
    action: RebaseAction;
    hash: string;
    shortHash: string;
    message: string;
    /** Date relative, ex: "3 hours ago" — fournie par git %ar */
    date: string;
    /** Date absolue, ex: "2024-06-15 10:30:00 +0200" — git %ai, affichée en tooltip */
    isoDate: string;
    /**
     * Nouveau message de commit, renseigné uniquement quand action === 'reword'.
     * Undefined = conserver le message original.
     */
    newMessage?: string;
}
