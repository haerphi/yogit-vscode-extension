import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import type { ModalOptions, ModalResult } from '../types/modal';

// Re-export pour que les appelants n'aient pas besoin de connaître types/modal.ts
export type {
    ModalButton,
    ModalCheckbox,
    ModalInput,
    ModalOptions,
    ModalResult,
    ModalSelect,
    ModalSelectOption,
} from '../types/modal';

/**
 * Modale de confirmation custom basée sur un WebviewPanel chargé via Lit.
 *
 * Architecture :
 *   - L'extension host génère un shell HTML minimal qui charge out/webview/modal.js
 *     (bundlé par esbuild depuis src/webview/modal/index.ts + yogit-modal.ts).
 *   - Les options sont passées via `window.__YOGIT_OPTIONS__` injecté dans le HTML
 *     avant le chargement du script — aucun postMessage aller n'est nécessaire.
 *   - Le composant Lit `<yogit-modal>` gère le rendu et renvoie le résultat via postMessage.
 *
 * Retourne null si l'utilisateur ferme le panneau sans choisir ou clique "Annuler".
 */
export class ConfirmModal {
    // Modales ouvertes indexées par clé de déduplication — évite d'empiler plusieurs
    // confirmations identiques quand l'utilisateur re-clique sur la même action.
    private static readonly openPanels = new Map<string, vscode.WebviewPanel>();

    static show(
        context: vscode.ExtensionContext,
        options: ModalOptions,
        dedupeKey?: string,
    ): Promise<ModalResult | null> {
        if (dedupeKey) {
            const existing = ConfirmModal.openPanels.get(dedupeKey);
            if (existing) {
                // Ramener la modale déjà ouverte au premier plan ; le re-clic est
                // traité comme une annulation pour ne pas dupliquer l'action en aval.
                existing.reveal();
                return Promise.resolve(null);
            }
        }
        return new Promise(resolve => {
            const panel = vscode.window.createWebviewPanel(
                'yogit-confirm-modal',
                options.title,
                vscode.ViewColumn.Active,
                {
                    enableScripts: true,
                    // Les valeurs saisies ne vivent que dans le DOM du webview (lues au
                    // submit). Sans ce flag, masquer la modale — changer d'onglet, ouvrir
                    // une autre vue — détruit son contexte : au retour le HTML est rechargé
                    // depuis __YOGIT_OPTIONS__ et les champs sont vidés.
                    retainContextWhenHidden: true,
                    // Restreindre les ressources chargables au dossier out/webview/
                    // pour respecter le principe de moindre privilège des webviews VS Code.
                    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
                },
            );

            if (dedupeKey) {
                ConfirmModal.openPanels.set(dedupeKey, panel);
            }

            panel.webview.html = ConfirmModal.buildHtml(panel.webview, context, options);

            // IMPORTANT : onDidDispose se déclenche de manière SYNCHRONE lors de
            // panel.dispose(). Sans ce flag, onDidDispose appellerait resolve(null)
            // avant que resolve(result) ne soit atteint dans onDidReceiveMessage.
            let resolved = false;

            panel.webview.onDidReceiveMessage((result: ModalResult | { cancel: true }) => {
                resolved = true;
                panel.dispose();
                resolve('cancel' in result ? null : result);
            });

            panel.onDidDispose(() => {
                if (dedupeKey) {
                    ConfirmModal.openPanels.delete(dedupeKey);
                }
                if (!resolved) {
                    resolve(null);
                }
            });
        });
    }

    /**
     * Génère le shell HTML minimal de la modale.
     *
     * Sécurité :
     *   - La CSP autorise uniquement les scripts depuis l'origine webview (fichier bundlé)
     *     et le script inline portant le nonce.
     *   - Un nonce est généré aléatoirement à chaque ouverture pour le script inline
     *     qui injecte les options. Sans nonce, le script inline serait bloqué par la CSP
     *     et `window.__YOGIT_OPTIONS__` resterait undefined → modale vide.
     *   - Les options sont échappées pour éviter toute injection via `</script>`.
     */
    private static buildHtml(webview: vscode.Webview, context: vscode.ExtensionContext, options: ModalOptions): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'modal.js'));

        // Nonce unique par ouverture — autorise uniquement CE script inline précis.
        const nonce = randomBytes(16).toString('hex');

        // Échapper < et > pour éviter qu'une valeur de type "</script>" dans les options
        // ne ferme prématurément le bloc script.
        const optionsJson = JSON.stringify(options).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

        return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'nonce-${nonce}'; style-src 'unsafe-inline';" />
    <style>
        body { margin: 0; background: var(--vscode-editor-background); }
    </style>
</head>
<body>
    <script nonce="${nonce}">window.__YOGIT_OPTIONS__ = ${optionsJson};</script>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
