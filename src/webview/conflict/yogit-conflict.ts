import { LitElement, css, html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { ConflictFile, ConflictHunk, FileSection } from '../../types/conflict';
import { pick } from '../shared/i18n';

declare global {
    interface Window {
        acquireVsCodeApi: () => { postMessage: (msg: unknown) => void };
    }
}

const vscode = window.acquireVsCodeApi();

const L = pick(
    {
        conflictNum: (n: number) => `Conflict ${n}`,
        keepOursTitle: 'Keep only our version (HEAD)',
        keepOurs: '← Keep ours',
        bothTitle: 'Keep both versions',
        both: 'Both',
        keepTheirsTitle: 'Keep only their version (incoming)',
        keepTheirs: 'Keep theirs →',
        noneTitle: 'Keep neither version',
        none: 'None',
        lblCurrent: 'HEAD (ours)',
        lblTheirs: 'Incoming (theirs)',
        finalEdited: '✏ Result (manually edited)',
        finalAuto: '▶ Result (from the selections)',
        fromSelections: '↺ From the selections',
        emptyPlaceholder: '(empty — the conflict will be removed)',
        loading: 'Loading…',
        conflictsTitle: (fileName: string) => `⚠ Conflicts — ${fileName}`,
        unresolved: (n: number) => `${n} unresolved`,
        allResolved: '✓ All resolved',
        footerHint: (n: number) =>
            `${n} conflict${n > 1 ? 's' : ''} — click on lines to include them in the result, or edit the result area directly.`,
        savedBanner: '✓ Saved and staged',
        saving: 'Saving…',
        saveButton: 'Save and stage',
    },
    {
        conflictNum: (n: number) => `Conflit ${n}`,
        keepOursTitle: 'Garder uniquement notre version (HEAD)',
        keepOurs: '← Garder le nôtre',
        bothTitle: 'Garder les deux versions',
        both: 'Les deux',
        keepTheirsTitle: 'Garder uniquement leur version (entrante)',
        keepTheirs: 'Garder les leurs →',
        noneTitle: 'Ne garder aucune des deux versions',
        none: 'Aucun',
        lblCurrent: 'HEAD (le nôtre)',
        lblTheirs: 'Entrant (les leurs)',
        finalEdited: '✏ Résultat (édité manuellement)',
        finalAuto: '▶ Résultat (depuis les sélections)',
        fromSelections: '↺ Depuis les sélections',
        emptyPlaceholder: '(vide — le conflit sera supprimé)',
        loading: 'Chargement…',
        conflictsTitle: (fileName: string) => `⚠ Conflits — ${fileName}`,
        unresolved: (n: number) => `${n} non résolu${n > 1 ? 's' : ''}`,
        allResolved: '✓ Tout résolu',
        footerHint: (n: number) =>
            `${n} conflit${n > 1 ? 's' : ''} — cliquez sur les lignes pour les inclure dans le résultat, ou éditez directement la zone de résultat.`,
        savedBanner: '✓ Sauvegardé et indexé',
        saving: 'Sauvegarde…',
        saveButton: 'Sauvegarder et indexer',
    },
);

type HostMessage = { type: 'file'; file: ConflictFile } | { type: 'error'; message: string } | { type: 'saved' };

export class YogitConflict extends LitElement {
    static properties = {
        _file: { state: true },
        _error: { state: true },
        _saving: { state: true },
        _saved: { state: true },
    };

    declare _file: ConflictFile | null;
    declare _error: string;
    declare _saving: boolean;
    declare _saved: boolean;

    constructor() {
        super();
        this._file = null;
        this._error = '';
        this._saving = false;
        this._saved = false;
    }

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
            const msg = event.data;
            if (msg.type === 'file') {
                this._file = msg.file;
                this._error = '';
                this._saved = false;
            } else if (msg.type === 'error') {
                this._error = msg.message;
            } else if (msg.type === 'saved') {
                this._saving = false;
                this._saved = true;
            }
        });
        vscode.postMessage({ type: 'ready' });
    }

    // ── Mutation helpers ─────────────────────────────────────────────────────

    private _updateHunk(hunkId: number, fn: (h: ConflictHunk) => ConflictHunk) {
        if (!this._file) {
            return;
        }
        this._file = {
            ...this._file,
            sections: this._file.sections.map(s =>
                s.type === 'conflict' && s.hunk.id === hunkId ? { ...s, hunk: fn(s.hunk) } : s,
            ),
        };
        this._saved = false;
    }

    /** Reconstruit le texte final dans l'ordre de sélection (ordre des clics). */
    private _rebuildFinalContent(h: ConflictHunk): string {
        return h.selectionOrder
            .map(({ side, idx }) => (side === 'current' ? h.currentLines[idx] : h.theirsLines[idx]))
            .join('\n');
    }

    private _toggleCurrentLine(hunkId: number, idx: number) {
        this._updateHunk(hunkId, h => {
            const currentSelected = [...h.currentSelected];
            const wasSelected = currentSelected[idx];
            currentSelected[idx] = !wasSelected;
            const selectionOrder = wasSelected
                ? h.selectionOrder.filter(e => !(e.side === 'current' && e.idx === idx))
                : [...h.selectionOrder, { side: 'current' as const, idx }];
            const updated = { ...h, currentSelected, selectionOrder };
            if (!h.finalEdited) {
                updated.finalContent = this._rebuildFinalContent(updated);
            }
            return updated;
        });
    }

    private _toggleTheirsLine(hunkId: number, idx: number) {
        this._updateHunk(hunkId, h => {
            const theirsSelected = [...h.theirsSelected];
            const wasSelected = theirsSelected[idx];
            theirsSelected[idx] = !wasSelected;
            const selectionOrder = wasSelected
                ? h.selectionOrder.filter(e => !(e.side === 'theirs' && e.idx === idx))
                : [...h.selectionOrder, { side: 'theirs' as const, idx }];
            const updated = { ...h, theirsSelected, selectionOrder };
            if (!h.finalEdited) {
                updated.finalContent = this._rebuildFinalContent(updated);
            }
            return updated;
        });
    }

    /** Boutons rapides : sélectionne tout d'un côté, des deux, ou rien. */
    private _quickSelect(hunkId: number, mode: 'current' | 'theirs' | 'both' | 'none') {
        this._updateHunk(hunkId, h => {
            const currentSelected = h.currentLines.map(() => mode === 'current' || mode === 'both');
            const theirsSelected = h.theirsLines.map(() => mode === 'theirs' || mode === 'both');
            // Pour les boutons rapides, l'ordre est naturel : current en premier, theirs ensuite
            const selectionOrder: ConflictHunk['selectionOrder'] = [];
            if (mode === 'current' || mode === 'both') {
                h.currentLines.forEach((_, i) => selectionOrder.push({ side: 'current', idx: i }));
            }
            if (mode === 'theirs' || mode === 'both') {
                h.theirsLines.forEach((_, i) => selectionOrder.push({ side: 'theirs', idx: i }));
            }
            const updated = { ...h, currentSelected, theirsSelected, selectionOrder, finalEdited: false };
            updated.finalContent = this._rebuildFinalContent(updated);
            return updated;
        });
    }

    private _setFinalContent(hunkId: number, value: string) {
        this._updateHunk(hunkId, h => ({ ...h, finalContent: value, finalEdited: true }));
    }

    /** Repasse en mode sélection (efface l'édition manuelle). */
    private _resetFinal(hunkId: number) {
        this._updateHunk(hunkId, h => ({
            ...h,
            finalEdited: false,
            finalContent: this._rebuildFinalContent(h),
        }));
    }

    // ── Calculs ──────────────────────────────────────────────────────────────

    private _isResolved(hunk: ConflictHunk): boolean {
        if (hunk.finalEdited) {
            return true;
        }
        return hunk.currentSelected.some(Boolean) || hunk.theirsSelected.some(Boolean);
    }

    private _unresolvedCount(): number {
        if (!this._file) {
            return 0;
        }
        return this._file.sections.filter(s => s.type === 'conflict' && !this._isResolved(s.hunk)).length;
    }

    private _buildFinal(): string {
        if (!this._file) {
            return '';
        }
        const lines: string[] = [];
        for (const s of this._file.sections) {
            if (s.type === 'context') {
                lines.push(...s.lines);
            } else {
                const h = s.hunk;
                if (h.finalEdited) {
                    if (h.finalContent) {
                        lines.push(...h.finalContent.split('\n'));
                    }
                } else {
                    for (const { side, idx } of h.selectionOrder) {
                        lines.push(side === 'current' ? h.currentLines[idx] : h.theirsLines[idx]);
                    }
                }
            }
        }
        return lines.join('\n');
    }

    private _save() {
        if (this._saving) {
            return;
        }
        this._saving = true;
        this._saved = false;
        vscode.postMessage({ type: 'save', content: this._buildFinal() });
    }

    // ── Styles ────────────────────────────────────────────────────────────────

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
            padding: 10px 16px 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .header-title {
            font-size: 13px;
            font-weight: 600;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .badge-unresolved {
            font-size: 11px;
            padding: 2px 7px;
            border-radius: 10px;
            background: rgba(224, 78, 78, 0.2);
            color: var(--vscode-errorForeground, #e04e4e);
            border: 1px solid var(--vscode-errorForeground, #e04e4e);
            white-space: nowrap;
        }

        .badge-ok {
            font-size: 11px;
            padding: 2px 7px;
            border-radius: 10px;
            background: rgba(78, 201, 78, 0.15);
            color: #4ec94e;
            border: 1px solid #4ec94e;
            white-space: nowrap;
        }

        .scroll-area {
            flex: 1;
            overflow-y: auto;
            padding: 8px 0;
        }

        .ctx-block {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            padding: 2px 16px;
            color: var(--vscode-descriptionForeground);
            white-space: pre;
            line-height: 1.5;
        }

        /* ── Carte de conflit ─────────────────────────────────────────────── */
        .conflict-card {
            margin: 8px 16px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            overflow: hidden;
        }

        .conflict-card.resolved {
            border-color: #4ec94e;
        }

        .card-header {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            background: var(--vscode-editorGroupHeader-tabsBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            font-size: 11px;
            flex-wrap: wrap;
        }

        .card-num {
            color: var(--vscode-descriptionForeground);
            font-weight: 600;
        }

        .card-status {
            font-size: 11px;
            color: #4ec94e;
        }

        .card-actions {
            display: flex;
            gap: 4px;
            margin-left: auto;
            flex-wrap: wrap;
        }

        .btn-quick {
            padding: 2px 8px;
            font-size: 11px;
            font-family: var(--vscode-font-family);
            cursor: pointer;
            border-radius: 3px;
            border: 1px solid var(--vscode-panel-border);
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            white-space: nowrap;
        }

        .btn-quick:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .btn-quick.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: transparent;
        }

        /* ── Colonnes Current / Theirs ────────────────────────────────────── */
        .sides {
            display: grid;
            grid-template-columns: 1fr 1fr;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .side {
            padding: 4px 0;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            line-height: 1.5;
            min-height: 24px;
        }

        .side-current {
            background: rgba(78, 157, 224, 0.05);
            border-right: 1px solid var(--vscode-panel-border);
        }

        .side-theirs {
            background: rgba(158, 78, 224, 0.05);
        }

        .side-label {
            font-family: var(--vscode-font-family);
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            padding: 2px 8px;
            display: block;
            font-weight: 600;
        }

        .lbl-current {
            color: #4e9de0;
        }
        .lbl-theirs {
            color: #9e4ee0;
        }

        /* ── Ligne sélectionnable ─────────────────────────────────────────── */
        .line-row {
            display: flex;
            align-items: flex-start;
            gap: 0;
            cursor: pointer;
            user-select: none;
        }

        .line-row:hover .line-toggle {
            opacity: 1;
        }

        .line-row:hover {
            background: rgba(255, 255, 255, 0.04);
        }

        .line-row.sel-current {
            background: rgba(78, 157, 224, 0.18);
        }

        .line-row.sel-theirs {
            background: rgba(158, 78, 224, 0.18);
        }

        .line-toggle {
            flex-shrink: 0;
            width: 22px;
            text-align: center;
            font-size: 11px;
            padding-top: 1px;
            color: var(--vscode-descriptionForeground);
            opacity: 0.5;
        }

        .line-row.sel-current .line-toggle {
            color: #4e9de0;
            opacity: 1;
        }

        .line-row.sel-theirs .line-toggle {
            color: #9e4ee0;
            opacity: 1;
        }

        .line-text {
            flex: 1;
            white-space: pre-wrap;
            word-break: break-all;
            padding: 0 6px 0 0;
            color: var(--vscode-foreground);
        }

        /* ── Zone résultat final ──────────────────────────────────────────── */
        .final-section {
            background: rgba(78, 201, 78, 0.04);
        }

        .final-header {
            display: flex;
            align-items: center;
            padding: 3px 10px 3px 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
            gap: 8px;
        }

        .final-label {
            font-size: 10px;
            font-weight: 600;
            color: #4ec94e;
            flex: 1;
        }

        .final-label.edited {
            color: #e09a4e;
        }

        .btn-reset-final {
            font-size: 10px;
            padding: 1px 7px;
            cursor: pointer;
            border-radius: 3px;
            border: 1px solid #e09a4e;
            background: rgba(224, 154, 78, 0.1);
            color: #e09a4e;
            font-family: var(--vscode-font-family);
            white-space: nowrap;
        }

        .btn-reset-final:hover {
            background: rgba(224, 154, 78, 0.2);
        }

        .final-textarea {
            width: 100%;
            box-sizing: border-box;
            padding: 6px 10px;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            line-height: 1.5;
            background: transparent;
            color: var(--vscode-foreground);
            border: none;
            outline: none;
            resize: vertical;
            min-height: 48px;
        }

        .final-textarea:focus {
            background: rgba(255, 255, 255, 0.02);
        }

        /* ── Footer ──────────────────────────────────────────────────────── */
        .footer {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 16px;
            border-top: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
        }

        .footer-hint {
            flex: 1;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
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
        }

        .btn-primary:hover:not(:disabled) {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .saved-banner {
            font-size: 11px;
            color: #4ec94e;
        }

        .state-msg {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        .error-banner {
            margin: 8px 16px;
            padding: 8px 12px;
            background: rgba(224, 78, 78, 0.12);
            border: 1px solid var(--vscode-inputValidation-errorBorder, #e04e4e);
            border-radius: 4px;
            font-size: 12px;
            color: var(--vscode-errorForeground, #e04e4e);
        }
    `;

    // ── Rendu ────────────────────────────────────────────────────────────────

    private _renderLineRow(
        line: string,
        selected: boolean,
        sideClass: 'sel-current' | 'sel-theirs',
        onToggle: () => void,
    ) {
        return html`
            <div class="line-row ${selected ? sideClass : ''}" @click=${onToggle}>
                <span class="line-toggle">${selected ? '✓' : '·'}</span>
                <code class="line-text">${line || ' '}</code>
            </div>
        `;
    }

    private _renderHunk(hunk: ConflictHunk, cardIdx: number) {
        const resolved = this._isResolved(hunk);
        const allCurrentSel = hunk.currentSelected.every(Boolean);
        const allTheirsSel = hunk.theirsSelected.every(Boolean);
        const noneSel = hunk.currentSelected.every(v => !v) && hunk.theirsSelected.every(v => !v);
        const rows = Math.max(3, (hunk.finalContent.match(/\n/g)?.length ?? 0) + 1);

        return html`
            <div class="conflict-card ${resolved ? 'resolved' : ''}">
                <div class="card-header">
                    <span class="card-num">${L.conflictNum(cardIdx + 1)}</span>
                    ${resolved ? html`<span class="card-status">✓</span>` : nothing}
                    <div class="card-actions">
                        <button
                            class="btn-quick ${allCurrentSel && !allTheirsSel && !hunk.finalEdited ? 'active' : ''}"
                            title=${L.keepOursTitle}
                            @click=${() => this._quickSelect(hunk.id, 'current')}
                        >
                            ${L.keepOurs}
                        </button>
                        <button
                            class="btn-quick ${allCurrentSel && allTheirsSel && !hunk.finalEdited ? 'active' : ''}"
                            title=${L.bothTitle}
                            @click=${() => this._quickSelect(hunk.id, 'both')}
                        >
                            ${L.both}
                        </button>
                        <button
                            class="btn-quick ${!allCurrentSel && allTheirsSel && !hunk.finalEdited ? 'active' : ''}"
                            title=${L.keepTheirsTitle}
                            @click=${() => this._quickSelect(hunk.id, 'theirs')}
                        >
                            ${L.keepTheirs}
                        </button>
                        <button
                            class="btn-quick ${noneSel && !hunk.finalEdited ? 'active' : ''}"
                            title=${L.noneTitle}
                            @click=${() => this._quickSelect(hunk.id, 'none')}
                        >
                            ${L.none}
                        </button>
                    </div>
                </div>

                <div class="sides">
                    <div class="side side-current">
                        <span class="side-label lbl-current">${L.lblCurrent}</span>
                        ${hunk.currentLines.map((line, i) =>
                            this._renderLineRow(line, hunk.currentSelected[i], 'sel-current', () =>
                                this._toggleCurrentLine(hunk.id, i),
                            ),
                        )}
                    </div>
                    <div class="side side-theirs">
                        <span class="side-label lbl-theirs">${L.lblTheirs}</span>
                        ${hunk.theirsLines.map((line, i) =>
                            this._renderLineRow(line, hunk.theirsSelected[i], 'sel-theirs', () =>
                                this._toggleTheirsLine(hunk.id, i),
                            ),
                        )}
                    </div>
                </div>

                <div class="final-section">
                    <div class="final-header">
                        <span class="final-label ${hunk.finalEdited ? 'edited' : ''}">
                            ${hunk.finalEdited ? L.finalEdited : L.finalAuto}
                        </span>
                        ${hunk.finalEdited
                            ? html`<button class="btn-reset-final" @click=${() => this._resetFinal(hunk.id)}>
                                  ${L.fromSelections}
                              </button>`
                            : nothing}
                    </div>
                    <textarea
                        class="final-textarea"
                        rows=${rows}
                        .value=${live(hunk.finalContent)}
                        placeholder=${L.emptyPlaceholder}
                        @input=${(e: InputEvent) =>
                            this._setFinalContent(hunk.id, (e.target as HTMLTextAreaElement).value)}
                    ></textarea>
                </div>
            </div>
        `;
    }

    private _renderSection(section: FileSection, conflictIdx: { v: number }) {
        if (section.type === 'context') {
            if (section.lines.every(l => l === '')) {
                return nothing;
            }
            return html`<div class="ctx-block">${section.lines.join('\n')}</div>`;
        }
        const idx = conflictIdx.v++;
        return this._renderHunk(section.hunk, idx);
    }

    render() {
        if (!this._file) {
            return html`<div class="state-msg">${L.loading}</div>`;
        }

        const unresolved = this._unresolvedCount();
        const total = this._file.sections.filter(s => s.type === 'conflict').length;
        const conflictIdx = { v: 0 };
        const canSave = unresolved === 0;

        return html`
            <div class="header">
                <span class="header-title">${L.conflictsTitle(this._file.fileName)}</span>
                ${unresolved > 0
                    ? html`<span class="badge-unresolved">${L.unresolved(unresolved)}</span>`
                    : html`<span class="badge-ok">${L.allResolved}</span>`}
            </div>
            ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}
            <div class="scroll-area">${this._file.sections.map(s => this._renderSection(s, conflictIdx))}</div>
            <div class="footer">
                <span class="footer-hint"> ${L.footerHint(total)} </span>
                ${this._saved ? html`<span class="saved-banner">${L.savedBanner}</span>` : nothing}
                <button class="btn btn-primary" ?disabled=${!canSave || this._saving} @click=${this._save}>
                    ${this._saving ? L.saving : L.saveButton}
                </button>
            </div>
        `;
    }
}

customElements.define('yogit-conflict', YogitConflict);
