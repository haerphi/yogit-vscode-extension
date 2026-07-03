/**
 * Types partagés entre l'extension host (ConfirmModal.ts) et le webview (yogit-modal.ts).
 * Ce fichier ne doit importer ni `vscode` ni aucun module Node.js — il doit rester
 * importable des deux côtés de la frontière extension host / webview.
 */

export interface ModalButton {
    label: string;
    /** Valeur retournée dans ModalResult.button quand ce bouton est cliqué. */
    value: string;
    variant?: 'primary' | 'secondary' | 'danger';
}

export interface ModalCheckbox {
    id: string;
    label: string;
    checked?: boolean;
}

export interface ModalInput {
    id: string;
    label: string;
    placeholder?: string;
    /** Valeur pré-remplie du champ. */
    value?: string;
}

export interface ModalOptions {
    title: string;
    /** Message principal affiché en haut du corps. */
    message: string;
    /** Texte secondaire en gris sous le message principal. */
    detail?: string;
    /** Bandeau d'avertissement orange, pour les actions destructrices. */
    warning?: string;
    buttons: ModalButton[];
    checkboxes?: ModalCheckbox[];
    /** Champs texte affichés au-dessus des checkboxes. */
    inputs?: ModalInput[];
}

export interface ModalResult {
    /** Valeur du bouton cliqué (ex: 'confirm', 'force'). */
    button: string;
    /** État de chaque checkbox au moment du clic, indexé par leur id. */
    checkboxes: Record<string, boolean>;
    /** Valeur de chaque champ texte au moment du clic, indexée par leur id. */
    inputs: Record<string, string>;
}
