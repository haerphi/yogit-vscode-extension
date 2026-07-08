import { LitElement, css, html } from 'lit';
import { RebaseAction, RebaseEntry } from '../../types/rebase';
import { pick } from '../shared/i18n';

declare global {
    interface Window {
        acquireVsCodeApi: () => { postMessage: (msg: unknown) => void };
        __YOGIT_REBASE_DEFAULT_ORDER__?: 'oldest-first' | 'newest-first';
    }
}

const vscode = window.acquireVsCodeApi();

const L = pick(
    {
        moveUp: 'Move up',
        moveDown: 'Move down',
        dragHint: 'Drag to reorder',
        loading: 'Loading commits…',
        nothingToRebase: (label: string) => `No commit to rebase onto "${label}".`,
        close: 'Close',
        headerTitle: (label: string) => `Interactive rebase onto "${label}"`,
        headerSub: (n: number, reversed: boolean) =>
            reversed
                ? `${n} commit${n > 1 ? 's' : ''} — from newest (top) to oldest (bottom)`
                : `${n} commit${n > 1 ? 's' : ''} — from oldest (top) to newest (bottom)`,
        orderNewestTop: 'Newest on top',
        orderOldestTop: 'Oldest on top',
        orderToggleHint: 'Toggle display order',
        preview: 'Preview',
        previewHint: 'Preview the final result',
        previewTitle: 'Final result',
        previewCount: (result: number, source: number) =>
            result === source
                ? `${result} commit${result > 1 ? 's' : ''}`
                : `${result} commit${result > 1 ? 's' : ''} (from ${source})`,
        previewDisclaimer: 'Indicative preview — exact squash messages may differ slightly.',
        previewEmpty: 'All commits will be dropped — nothing will remain after the rebase.',
        previewReworded: 'Message will be changed (reword)',
        done: '✓ Rebase completed successfully.',
        colOrder: 'Order',
        colAction: 'Action',
        colHash: 'Hash',
        colDate: 'Date',
        colMessage: 'Message',
        allDropped: 'All commits will be dropped.',
        activeCount: (n: number) => `${n} active commit${n > 1 ? 's' : ''}.`,
        restart: 'Restart',
        cancel: 'Cancel',
        running: 'Rebase in progress…',
        start: 'Start rebase',
    },
    {
        moveUp: 'Monter',
        moveDown: 'Descendre',
        dragHint: 'Glisser pour réordonner',
        loading: 'Chargement des commits…',
        nothingToRebase: (label: string) => `Aucun commit à rebaser sur « ${label} ».`,
        close: 'Fermer',
        headerTitle: (label: string) => `Rebase interactif sur « ${label} »`,
        headerSub: (n: number, reversed: boolean) =>
            reversed
                ? `${n} commit${n > 1 ? 's' : ''} — du plus récent (haut) au plus ancien (bas)`
                : `${n} commit${n > 1 ? 's' : ''} — du plus ancien (haut) au plus récent (bas)`,
        orderNewestTop: 'Plus récent en haut',
        orderOldestTop: 'Plus ancien en haut',
        orderToggleHint: "Inverser l'ordre d'affichage",
        preview: 'Aperçu',
        previewHint: 'Prévisualiser le résultat final',
        previewTitle: 'Résultat final',
        previewCount: (result: number, source: number) =>
            result === source
                ? `${result} commit${result > 1 ? 's' : ''}`
                : `${result} commit${result > 1 ? 's' : ''} (depuis ${source})`,
        previewDisclaimer: 'Aperçu indicatif — les messages de squash exacts peuvent légèrement différer.',
        previewEmpty: 'Tous les commits seront supprimés — il ne restera rien après le rebase.',
        previewReworded: 'Le message sera modifié (reword)',
        done: '✓ Rebase terminé avec succès.',
        colOrder: 'Ordre',
        colAction: 'Action',
        colHash: 'Hash',
        colDate: 'Date',
        colMessage: 'Message',
        allDropped: 'Tous les commits seront supprimés.',
        activeCount: (n: number) => `${n} commit${n > 1 ? 's' : ''} actif${n > 1 ? 's' : ''}.`,
        restart: 'Recommencer',
        cancel: 'Annuler',
        running: 'Rebase en cours…',
        start: 'Lancer le rebase',
    },
);

type HostMessage =
    | { type: 'entries'; entries: RebaseEntry[]; upstreamLabel: string }
    | { type: 'error'; message: string }
    | { type: 'running' }
    | { type: 'done' }
    | { type: 'rebase-error'; message: string };

const ACTION_LABELS: Record<RebaseAction, string> = {
    pick: 'pick',
    reword: 'reword',
    squash: 'squash',
    fixup: 'fixup',
    drop: 'drop',
};

/**
 * Couleur d'accent par action, appliquée en bordure gauche + léger fond teinté sur
 * toute la ligne — permet de scanner le plan de rebase en un coup d'œil sans lire
 * chaque select. `pick` (majorité des lignes, action par défaut) reste neutre pour
 * ne faire ressortir que les lignes réellement modifiées.
 */
const ACTION_ACCENT: Record<RebaseAction, string | null> = {
    pick: null,
    reword: '#e09a4e', // orange — modifie le message du commit
    squash: '#4e9de0', // bleu — fusionne dans le commit précédent en gardant les deux messages
    fixup: '#9e4ee0', // violet — comme squash, mais élimine ce message
    drop: '#e04e4e', // rouge — commit exclu du résultat final
};

/** Un commit tel qu'il existera une fois le plan de rebase appliqué (voir computeFinalCommits). */
interface FinalCommit {
    leadHash: string;
    subject: string;
    fullMessage: string;
    /** Nombre de commits d'origine fondus dans celui-ci (1 = inchangé, >1 = squash/fixup). */
    sourceCount: number;
    reworded: boolean;
}

/**
 * Simule le résultat du plan de rebase courant : squash/fixup fondent leur entrée dans
 * le commit actif précédent (comme le fait réellement `git rebase -i`), drop l'exclut,
 * pick/reword le gardent tel quel (avec le nouveau message pour reword).
 *
 * squash concatène son message à la suite de celui du commit actif ; fixup ne contribue
 * aucun texte (le sien est entièrement abandonné) — même sémantique que git.
 */
function computeFinalCommits(entries: RebaseEntry[]): FinalCommit[] {
    const result: FinalCommit[] = [];
    for (const entry of entries) {
        if (entry.action === 'drop') {
            continue;
        }
        const lead = result[result.length - 1];
        if ((entry.action === 'squash' || entry.action === 'fixup') && lead) {
            lead.sourceCount++;
            if (entry.action === 'squash') {
                lead.fullMessage += '\n\n' + entry.message;
            }
            continue;
        }
        const message = entry.action === 'reword' ? (entry.newMessage ?? entry.message) : entry.message;
        result.push({
            leadHash: entry.shortHash,
            subject: message.split('\n')[0] || message,
            fullMessage: message,
            sourceCount: 1,
            reworded: entry.action === 'reword',
        });
    }
    return result;
}

export class YogitRebase extends LitElement {
    static properties = {
        _entries: { state: true },
        _upstreamLabel: { state: true },
        _loading: { state: true },
        _error: { state: true },
        _running: { state: true },
        _done: { state: true },
        _rebaseError: { state: true },
        _draggingIdx: { state: true },
        _dragOverIdx: { state: true },
        _reversed: { state: true },
        _showPreview: { state: true },
    };

    declare _entries: RebaseEntry[];
    declare _upstreamLabel: string;
    declare _loading: boolean;
    declare _error: string;
    declare _running: boolean;
    declare _done: boolean;
    declare _rebaseError: string;
    // Index de la ligne en cours de glissement / de la ligne survolée — pilotent
    // les classes CSS .dragging et .drag-over pendant l'opération.
    declare _draggingIdx: number | null;
    declare _dragOverIdx: number | null;
    // Inverse uniquement l'AFFICHAGE (plus récent en haut) — this._entries reste
    // toujours dans l'ordre canonique attendu par git (plus ancien en premier),
    // seul renderEntry() reçoit des index traduits pour cet affichage.
    declare _reversed: boolean;
    // Affiche/masque le volet "Résultat final" — purement une préférence d'affichage.
    declare _showPreview: boolean;

    // Snapshot des entrées telles que reçues du host — permet le reset.
    private _initialEntries: RebaseEntry[] = [];

    constructor() {
        super();
        this._entries = [];
        this._upstreamLabel = '';
        this._loading = true;
        this._error = '';
        this._running = false;
        this._done = false;
        this._rebaseError = '';
        this._draggingIdx = null;
        this._dragOverIdx = null;
        // Préférence utilisateur (haerphi-yogit.rebase.defaultOrder), injectée par
        // RebasePanel — seul le sens d'affichage initial en dépend, le bouton reste
        // libre de basculer à tout moment.
        this._reversed = window.__YOGIT_REBASE_DEFAULT_ORDER__ === 'newest-first';
        this._showPreview = false;
    }

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
            const msg = event.data;
            if (msg.type === 'entries') {
                this._initialEntries = msg.entries.map(e => ({ ...e }));
                this._entries = msg.entries;
                this._upstreamLabel = msg.upstreamLabel;
                this._loading = false;
            } else if (msg.type === 'error') {
                this._error = msg.message;
                this._loading = false;
            } else if (msg.type === 'running') {
                this._running = true;
                this._rebaseError = '';
            } else if (msg.type === 'done') {
                this._running = false;
                this._done = true;
            } else if (msg.type === 'rebase-error') {
                this._running = false;
                this._rebaseError = msg.message;
            }
        });
        vscode.postMessage({ type: 'ready' });
    }

    private _moveUp(idx: number) {
        if (idx === 0) {
            return;
        }
        const entries = [...this._entries];
        [entries[idx - 1], entries[idx]] = [entries[idx], entries[idx - 1]];
        this._entries = entries;
    }

    private _moveDown(idx: number) {
        if (idx >= this._entries.length - 1) {
            return;
        }
        const entries = [...this._entries];
        [entries[idx], entries[idx + 1]] = [entries[idx + 1], entries[idx]];
        this._entries = entries;
    }

    /**
     * Annule le drag s'il démarre depuis un contrôle interactif (select/input) — sans
     * ce garde, saisir le texte du champ reword ou ouvrir le select d'action ferait
     * partir un drag de toute la ligne au lieu de l'interaction attendue.
     */
    private _onDragStart(e: DragEvent, idx: number) {
        if ((e.target as HTMLElement).closest('select, input')) {
            e.preventDefault();
            return;
        }
        this._draggingIdx = idx;
        e.dataTransfer?.setData('text/plain', String(idx));
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
        }
    }

    private _onDragOver(e: DragEvent, idx: number) {
        // preventDefault() est requis par la spec HTML5 DnD pour autoriser le drop.
        e.preventDefault();
        if (this._draggingIdx === null || this._draggingIdx === idx) {
            return;
        }
        this._dragOverIdx = idx;
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }
    }

    private _onDrop(e: DragEvent, idx: number) {
        e.preventDefault();
        const fromIdx = this._draggingIdx;
        this._draggingIdx = null;
        this._dragOverIdx = null;
        if (fromIdx === null || fromIdx === idx) {
            return;
        }
        const entries = [...this._entries];
        const [moved] = entries.splice(fromIdx, 1);
        entries.splice(idx, 0, moved);
        this._entries = entries;
    }

    private _onDragEnd() {
        // dragend se déclenche toujours (drop réussi, annulé, ou lâché hors cible) —
        // c'est le seul endroit fiable pour nettoyer l'état visuel dans tous les cas.
        this._draggingIdx = null;
        this._dragOverIdx = null;
    }

    private _setAction(idx: number, action: RebaseAction) {
        const entries = [...this._entries];
        const entry = entries[idx];
        entries[idx] = {
            ...entry,
            action,
            // Pré-remplir newMessage avec le message original quand on passe en reword.
            newMessage: action === 'reword' ? (entry.newMessage ?? entry.message) : entry.newMessage,
        };
        this._entries = entries;
    }

    private _setNewMessage(idx: number, value: string) {
        const entries = [...this._entries];
        entries[idx] = { ...entries[idx], newMessage: value };
        this._entries = entries;
    }

    private _start() {
        vscode.postMessage({ type: 'start', entries: this._entries });
    }

    private _cancel() {
        vscode.postMessage({ type: 'cancel' });
    }

    private _reset() {
        this._entries = this._initialEntries.map(e => ({ ...e }));
        this._rebaseError = '';
        this._done = false;
    }

    /** Inverse l'ordre d'affichage (plus récent en haut) sans toucher à this._entries. */
    private _toggleOrder() {
        this._reversed = !this._reversed;
        this._draggingIdx = null;
        this._dragOverIdx = null;
    }

    private _togglePreview() {
        this._showPreview = !this._showPreview;
    }

    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            height: 100vh;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            box-sizing: border-box;
        }

        .header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 10px;
            padding: 10px 16px 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
        }

        .header-text {
            min-width: 0;
        }

        .header-title {
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 4px;
        }

        .header-sub {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .header-actions {
            display: flex;
            gap: 6px;
            flex-shrink: 0;
        }

        .btn-toggle {
            flex-shrink: 0;
            padding: 3px 10px;
            border-radius: 3px;
            font-size: 11px;
            cursor: pointer;
            border: 1px solid var(--vscode-panel-border);
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            font-family: var(--vscode-font-family);
            white-space: nowrap;
        }

        .btn-toggle:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .btn-toggle.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
        }

        .body-split {
            display: flex;
            flex: 1;
            min-height: 0;
        }

        .entry-list {
            flex: 1;
            overflow-y: auto;
            padding: 4px 0;
        }

        .preview-panel {
            width: 280px;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            border-left: 1px solid var(--vscode-panel-border);
        }

        .preview-header {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 8px;
            padding: 8px 12px 4px;
            flex-shrink: 0;
        }

        .preview-title {
            font-size: 12px;
            font-weight: 600;
        }

        .preview-count {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
        }

        .preview-disclaimer {
            font-size: 10px;
            font-style: italic;
            color: var(--vscode-descriptionForeground);
            padding: 0 12px 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .preview-list {
            flex: 1;
            overflow-y: auto;
            padding: 6px 0;
        }

        .preview-item {
            display: flex;
            align-items: flex-start;
            gap: 6px;
            padding: 4px 12px;
            font-size: 12px;
        }

        .preview-dot {
            flex-shrink: 0;
            width: 8px;
            height: 8px;
            margin-top: 3px;
            border-radius: 50%;
            background: var(--vscode-descriptionForeground);
            opacity: 0.5;
        }

        .preview-dot.reworded {
            background: #e09a4e;
            opacity: 1;
        }

        .preview-subject {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .preview-badge {
            flex-shrink: 0;
            font-size: 10px;
            padding: 0 5px;
            border-radius: 8px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }

        .preview-empty {
            padding: 12px;
            font-size: 12px;
            font-style: italic;
            color: var(--vscode-descriptionForeground);
        }

        .entry-row {
            display: flex;
            align-items: center;
            gap: 6px;
            /* padding-left compense la largeur de border-left pour rester aligné
               sur le padding de .col-header (qui n'a pas de bordure). */
            padding: 4px 12px 4px 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
            border-left: 4px solid var(--accent, transparent);
            background: color-mix(in srgb, var(--accent, transparent) 14%, transparent);
            transition: background 0.1s;
            cursor: grab;
        }

        .entry-row:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .entry-row.dragging {
            opacity: 0.4;
            cursor: grabbing;
        }

        /* Ligne survolée pendant un drag — indique où la ligne relâchée atterrira. */
        .entry-row.drag-over {
            outline: 2px dashed var(--vscode-focusBorder);
            outline-offset: -2px;
        }

        .entry-row.drop .entry-hash,
        .entry-row.drop .entry-date,
        .entry-row.drop .action-select {
            opacity: 0.55;
        }

        .entry-row.drop .entry-msg {
            opacity: 0.55;
            text-decoration: line-through;
        }

        /* Largeur alignée sur .col-order pour que la poignée + les flèches
           restent sous l'en-tête "Ordre" malgré l'ajout de la poignée de drag. */
        .order-cell {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
            width: 44px;
        }

        .move-btns {
            display: flex;
            flex-direction: column;
            gap: 1px;
            flex-shrink: 0;
        }

        .move-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 14px;
            cursor: pointer;
            border-radius: 2px;
            color: var(--vscode-descriptionForeground);
            user-select: none;
            font-size: 10px;
            line-height: 1;
        }

        .move-btn:hover {
            background: var(--vscode-list-hoverBackground);
            color: var(--vscode-foreground);
        }

        .move-btn:active {
            background: var(--vscode-list-activeSelectionBackground);
        }

        .move-btn.disabled {
            opacity: 0.25;
            cursor: default;
        }

        .drag-handle {
            flex-shrink: 0;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            line-height: 1;
            user-select: none;
        }

        .action-select {
            flex-shrink: 0;
            width: 76px;
            background-color: var(--vscode-dropdown-background);
            /* Le texte de l'action (pick/squash/fixup…) reprend sa couleur d'accent —
               plus fiable que le contour seul, qui peut se fondre dans un thème clair. */
            color: var(--accent, var(--vscode-dropdown-foreground));
            border: 1px solid var(--accent, var(--vscode-dropdown-border, var(--vscode-panel-border)));
            border-radius: 3px;
            padding: 2px 4px;
            font-size: 11px;
            font-family: var(--vscode-editor-font-family, monospace);
            cursor: pointer;
        }

        .reword-input {
            flex: 1;
            min-width: 0;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid #4ec9c9;
            border-radius: 3px;
            padding: 2px 6px;
            font-size: 12px;
            font-family: var(--vscode-font-family);
            outline: none;
            /* Écrase le curseur "grab" hérité de .entry-row : ce champ s'édite, ne se glisse pas. */
            cursor: text;
        }

        .reword-input:focus {
            border-color: var(--vscode-focusBorder);
        }

        .entry-hash {
            flex-shrink: 0;
            width: 54px;
            font-size: 11px;
            font-family: var(--vscode-editor-font-family, monospace);
            color: var(--vscode-descriptionForeground);
        }

        .entry-msg {
            flex: 1;
            font-size: 12px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            min-width: 0;
        }

        .footer {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
            padding: 10px 16px;
            border-top: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
        }

        .btn {
            padding: 5px 14px;
            border-radius: 3px;
            font-size: 12px;
            cursor: pointer;
            border: 1px solid transparent;
            font-family: var(--vscode-font-family);
        }

        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
        }

        .btn-primary:hover:not(:disabled) {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-primary:disabled {
            opacity: 0.5;
            cursor: default;
        }

        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .hint {
            flex: 1;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .state-msg {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            font-size: 13px;
            flex-direction: column;
            gap: 8px;
        }

        .error-banner {
            margin: 8px 16px;
            padding: 8px 12px;
            background: rgba(224, 78, 78, 0.12);
            border: 1px solid var(--vscode-inputValidation-errorBorder, #e04e4e);
            border-radius: 4px;
            font-size: 12px;
            color: var(--vscode-errorForeground, #e04e4e);
            white-space: pre-wrap;
            word-break: break-word;
        }

        .done-banner {
            margin: 8px 16px;
            padding: 8px 12px;
            background: rgba(78, 201, 78, 0.12);
            border: 1px solid #4ec94e;
            border-radius: 4px;
            font-size: 12px;
            color: #4ec94e;
        }

        .col-header {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-editor-background);
            position: sticky;
            top: 0;
            z-index: 1;
            user-select: none;
        }

        .col-order {
            width: 44px;
            flex-shrink: 0;
        }
        .col-action {
            width: 76px;
            flex-shrink: 0;
        }
        .col-hash {
            width: 54px;
            flex-shrink: 0;
        }

        .entry-date {
            flex-shrink: 0;
            width: 90px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .col-date {
            width: 90px;
            flex-shrink: 0;
        }
    `;

    /**
     * @param realIdx    Index dans this._entries (ordre canonique git) — utilisé pour
     *                   toute mutation (setAction, drag, etc.).
     * @param displayIdx Position dans la liste rendue à l'écran — utilisé uniquement
     *                   pour savoir si la ligne est visuellement première/dernière.
     */
    private renderEntry(entry: RebaseEntry, realIdx: number, displayIdx: number, total: number) {
        const isFirst = displayIdx === 0;
        const isLast = displayIdx === total - 1;
        const accent = ACTION_ACCENT[entry.action];
        const rowClasses = [
            'entry-row',
            entry.action === 'drop' ? 'drop' : '',
            this._draggingIdx === realIdx ? 'dragging' : '',
            this._dragOverIdx === realIdx && this._draggingIdx !== realIdx ? 'drag-over' : '',
        ]
            .filter(Boolean)
            .join(' ');

        // En affichage inversé, la flèche "monter" (vers le haut visuel = vers le plus
        // récent) doit avancer l'entrée dans this._entries — l'inverse de l'affichage normal.
        const onMoveUp = () => (this._reversed ? this._moveDown(realIdx) : this._moveUp(realIdx));
        const onMoveDown = () => (this._reversed ? this._moveUp(realIdx) : this._moveDown(realIdx));

        return html`
            <div
                class=${rowClasses}
                style=${accent ? `--accent: ${accent}` : ''}
                draggable="true"
                @dragstart=${(e: DragEvent) => this._onDragStart(e, realIdx)}
                @dragover=${(e: DragEvent) => this._onDragOver(e, realIdx)}
                @drop=${(e: DragEvent) => this._onDrop(e, realIdx)}
                @dragend=${() => this._onDragEnd()}
            >
                <div class="order-cell">
                    <span class="drag-handle" title=${L.dragHint}>⠿</span>
                    <div class="move-btns">
                        <div
                            class="move-btn ${isFirst ? 'disabled' : ''}"
                            title=${L.moveUp}
                            @click=${() => !isFirst && onMoveUp()}
                        >
                            ▲
                        </div>
                        <div
                            class="move-btn ${isLast ? 'disabled' : ''}"
                            title=${L.moveDown}
                            @click=${() => !isLast && onMoveDown()}
                        >
                            ▼
                        </div>
                    </div>
                </div>
                <select
                    class="action-select"
                    .value=${entry.action}
                    @change=${(e: Event) =>
                        this._setAction(realIdx, (e.target as HTMLSelectElement).value as RebaseAction)}
                >
                    ${(Object.keys(ACTION_LABELS) as RebaseAction[]).map(
                        a => html`<option value=${a} ?selected=${entry.action === a}>${ACTION_LABELS[a]}</option>`,
                    )}
                </select>
                <span class="entry-hash">${entry.shortHash}</span>
                <span class="entry-date">${entry.date}</span>
                ${entry.action === 'reword'
                    ? html`<input
                          class="reword-input"
                          type="text"
                          .value=${entry.newMessage ?? entry.message}
                          placeholder=${entry.message}
                          @input=${(e: InputEvent) =>
                              this._setNewMessage(realIdx, (e.target as HTMLInputElement).value)}
                      />`
                    : html`<span class="entry-msg" title=${entry.message}>${entry.message}</span>`}
            </div>
        `;
    }

    /** Volet rétractable montrant à quoi ressemblera l'historique une fois le rebase appliqué. */
    private renderPreview(sourceCount: number) {
        const finalCommits = computeFinalCommits(this._entries);
        const orderedCommits = this._reversed ? [...finalCommits].reverse() : finalCommits;

        return html`
            <div class="preview-panel">
                <div class="preview-header">
                    <span class="preview-title">${L.previewTitle}</span>
                    <span class="preview-count">${L.previewCount(finalCommits.length, sourceCount)}</span>
                </div>
                <div class="preview-disclaimer">${L.previewDisclaimer}</div>
                <div class="preview-list">
                    ${finalCommits.length === 0
                        ? html`<div class="preview-empty">${L.previewEmpty}</div>`
                        : orderedCommits.map(
                              fc => html`
                                  <div class="preview-item" title=${fc.fullMessage}>
                                      <span
                                          class="preview-dot ${fc.reworded ? 'reworded' : ''}"
                                          title=${fc.reworded ? L.previewReworded : ''}
                                      ></span>
                                      <span class="preview-subject">${fc.subject}</span>
                                      ${fc.sourceCount > 1
                                          ? html`<span class="preview-badge">×${fc.sourceCount}</span>`
                                          : ''}
                                  </div>
                              `,
                          )}
                </div>
            </div>
        `;
    }

    render() {
        if (this._loading) {
            return html`<div class="state-msg">${L.loading}</div>`;
        }
        if (this._error) {
            return html`<div class="state-msg state-error">${this._error}</div>`;
        }
        if (this._entries.length === 0) {
            return html`
                <div class="state-msg">
                    <span>${L.nothingToRebase(this._upstreamLabel)}</span>
                    <button class="btn btn-secondary" @click=${this._cancel}>${L.close}</button>
                </div>
            `;
        }

        const activeCount = this._entries.filter(e => e.action !== 'drop').length;
        const total = this._entries.length;
        // La liste affichée ne fait qu'inverser l'ordre de rendu — realIdx conserve
        // la position dans this._entries pour que les mutations restent correctes.
        const displayList = this._entries.map((entry, realIdx) => ({ entry, realIdx }));
        if (this._reversed) {
            displayList.reverse();
        }

        return html`
            <div class="header">
                <div class="header-text">
                    <div class="header-title">${L.headerTitle(this._upstreamLabel)}</div>
                    <div class="header-sub">${L.headerSub(total, this._reversed)}</div>
                </div>
                <div class="header-actions">
                    <button
                        class="btn-toggle ${this._showPreview ? 'active' : ''}"
                        title=${L.previewHint}
                        @click=${this._togglePreview}
                    >
                        👁 ${L.preview}
                    </button>
                    <button class="btn-toggle" title=${L.orderToggleHint} @click=${this._toggleOrder}>
                        ⇅ ${this._reversed ? L.orderOldestTop : L.orderNewestTop}
                    </button>
                </div>
            </div>
            ${this._rebaseError ? html`<div class="error-banner">${this._rebaseError}</div>` : ''}
            ${this._done ? html`<div class="done-banner">${L.done}</div>` : ''}
            <div class="body-split">
                <div class="entry-list">
                    <div class="col-header">
                        <div class="col-order">${L.colOrder}</div>
                        <div class="col-action">${L.colAction}</div>
                        <div class="col-hash">${L.colHash}</div>
                        <div class="col-date">${L.colDate}</div>
                        <div>${L.colMessage}</div>
                    </div>
                    ${displayList.map((d, displayIdx) => this.renderEntry(d.entry, d.realIdx, displayIdx, total))}
                </div>
                ${this._showPreview ? this.renderPreview(total) : ''}
            </div>
            <div class="footer">
                <span class="hint"> ${activeCount === 0 ? L.allDropped : L.activeCount(activeCount)} </span>
                <button class="btn btn-secondary" @click=${this._reset} ?disabled=${this._running}>${L.restart}</button>
                <button class="btn btn-secondary" @click=${this._cancel} ?disabled=${this._running}>${L.cancel}</button>
                <button class="btn btn-primary" @click=${this._start} ?disabled=${this._running || this._done}>
                    ${this._running ? L.running : L.start}
                </button>
            </div>
        `;
    }
}

customElements.define('yogit-rebase', YogitRebase);
