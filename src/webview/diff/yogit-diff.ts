import { LitElement, css, html } from 'lit';
import { FileDiff, Hunk, HunkSelection } from '../../types/diff';

declare global {
    interface Window {
        __YOGIT_DIFF__: FileDiff;
        acquireVsCodeApi: () => { postMessage: (msg: unknown) => void };
    }
}

const vscode = window.acquireVsCodeApi();

/**
 * Composant Lit pour la sélection de hunks/lignes avant staging.
 *
 * Données : window.__YOGIT_DIFF__ (FileDiff) injectées avant le chargement du script.
 * Résultat : postMessage({ selection: HunkSelection }) ou postMessage({ cancel: true }).
 *
 * Convention de sélection (par défaut, tout est sélectionné à l'ouverture) :
 *   - Checkbox de hunk cochée  → hunk entier sélectionné ('all')
 *   - Checkbox de ligne cochée → sélection ligne par ligne
 *   - Si toutes les lignes d'un hunk sont cochées → passe à 'all' automatiquement
 */
export class YogitDiff extends LitElement {
    static properties = {
        diff: { type: Object },
        selection: { type: Object },
    };

    // 'declare' évite que le class field avec useDefineForClassFields:true ne shadow
    // le getter/setter réactif installé par Lit sur le prototype.
    declare diff: FileDiff | null;
    declare selection: HunkSelection;

    constructor() {
        super();
        this.diff = null;
        this.selection = {};
    }

    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            height: 100vh;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: var(--vscode-editor-font-size, 13px);
            color: var(--vscode-editor-foreground);
            background: var(--vscode-editor-background);
        }

        .toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: var(--vscode-titleBar-activeBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
        }

        .filename {
            font-weight: 600;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        button {
            padding: 4px 12px;
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 12px;
        }

        .btn-stage {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn-stage:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-stage:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .btn-cancel {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-cancel:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .hunks {
            overflow-y: auto;
            flex: 1;
        }

        .hunk {
            margin-bottom: 1px;
        }

        .hunk-header {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 3px 8px;
            background: var(--vscode-diffEditor-unchangedRegionBackground, #2a2d2e);
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
            user-select: none;
            cursor: pointer;
        }

        .hunk-header:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .hint {
            color: var(--vscode-descriptionForeground);
            opacity: 0.7;
        }

        .line {
            display: flex;
            align-items: stretch;
            min-height: 19px;
            white-space: pre;
        }

        .line-checkbox-cell {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            flex-shrink: 0;
            cursor: pointer;
        }

        .line-prefix {
            width: 14px;
            flex-shrink: 0;
            text-align: center;
            user-select: none;
        }

        .line-content {
            flex: 1;
            padding: 0 4px;
            overflow: hidden;
        }

        .line-add {
            background: var(--vscode-diffEditor-insertedLineBackground, rgba(0, 255, 0, 0.1));
        }

        .line-add .line-prefix {
            color: #4ec94e;
        }

        .line-remove {
            background: var(--vscode-diffEditor-removedLineBackground, rgba(255, 0, 0, 0.1));
        }

        .line-remove .line-prefix {
            color: #f47474;
        }

        .line-dimmed {
            opacity: 0.4;
        }

        input[type='checkbox'] {
            accent-color: var(--vscode-checkbox-background);
            cursor: pointer;
            width: 12px;
            height: 12px;
        }
    `;

    connectedCallback() {
        super.connectedCallback();
        this.diff = window.__YOGIT_DIFF__;
        if (this.diff) {
            // Tout sélectionné par défaut
            const sel: HunkSelection = {};
            for (const hunk of this.diff.hunks) {
                sel[hunk.index] = 'all';
            }
            this.selection = sel;
        }
    }

    private countSelected(): number {
        if (!this.diff) {
            return 0;
        }
        let count = 0;
        for (const hunk of this.diff.hunks) {
            const sel = this.selection[hunk.index];
            if (sel === 'all') {
                count += hunk.lines.filter(l => l.type !== 'context').length;
            } else if (Array.isArray(sel)) {
                count += sel.length;
            }
        }
        return count;
    }

    private toggleHunk(hunk: Hunk) {
        const current = this.selection[hunk.index];
        const changeLines = hunk.lines.filter(l => l.type !== 'context');
        const isSelected = current === 'all' || (Array.isArray(current) && current.length === changeLines.length);

        const next = { ...this.selection };
        if (isSelected) {
            delete next[hunk.index];
        } else {
            next[hunk.index] = 'all';
        }
        this.selection = next;
    }

    private toggleLine(hunk: Hunk, lineIndex: number) {
        const current = this.selection[hunk.index];
        const changeLines = hunk.lines.filter(l => l.type !== 'context');

        let currentSet: Set<number>;
        if (current === 'all') {
            currentSet = new Set(changeLines.map(l => l.index));
        } else if (Array.isArray(current)) {
            currentSet = new Set(current);
        } else {
            currentSet = new Set();
        }

        if (currentSet.has(lineIndex)) {
            currentSet.delete(lineIndex);
        } else {
            currentSet.add(lineIndex);
        }

        const next = { ...this.selection };
        if (currentSet.size === 0) {
            delete next[hunk.index];
        } else if (currentSet.size === changeLines.length) {
            next[hunk.index] = 'all';
        } else {
            next[hunk.index] = Array.from(currentSet);
        }
        this.selection = next;
    }

    private isHunkChecked(hunk: Hunk): boolean {
        const sel = this.selection[hunk.index];
        if (sel === 'all') {
            return true;
        }
        if (!Array.isArray(sel)) {
            return false;
        }
        const changeLines = hunk.lines.filter(l => l.type !== 'context');
        return sel.length === changeLines.length;
    }

    private isHunkIndeterminate(hunk: Hunk): boolean {
        const sel = this.selection[hunk.index];
        if (!Array.isArray(sel)) {
            return false;
        }
        const changeLines = hunk.lines.filter(l => l.type !== 'context');
        return sel.length > 0 && sel.length < changeLines.length;
    }

    private isLineChecked(hunk: Hunk, lineIndex: number): boolean {
        const sel = this.selection[hunk.index];
        if (sel === 'all') {
            return true;
        }
        if (Array.isArray(sel)) {
            return sel.includes(lineIndex);
        }
        return false;
    }

    private stage() {
        vscode.postMessage({ selection: this.selection });
    }

    private cancel() {
        vscode.postMessage({ cancel: true });
    }

    // Lit doesn't support setting .indeterminate in html template easily — use updated()
    updated() {
        if (!this.diff) {
            return;
        }
        for (const hunk of this.diff.hunks) {
            const cb = this.shadowRoot?.querySelector<HTMLInputElement>(`#hunk-cb-${hunk.index}`);
            if (cb) {
                cb.indeterminate = this.isHunkIndeterminate(hunk);
            }
        }
    }

    render() {
        if (!this.diff) {
            return html`<div>Chargement…</div>`;
        }

        const selected = this.countSelected();

        return html`
            <div class="toolbar">
                <span class="filename">${this.diff.filePath}</span>
                <button class="btn-cancel" @click=${this.cancel}>Annuler</button>
                <button class="btn-stage" ?disabled=${selected === 0} @click=${this.stage}>
                    ${this.diff.actionLabel ?? 'Indexer'} (${selected} ligne${selected > 1 ? 's' : ''})
                </button>
            </div>
            <div class="hunks">${this.diff.hunks.map(hunk => this.renderHunk(hunk))}</div>
        `;
    }

    private renderHunk(hunk: Hunk) {
        const checked = this.isHunkChecked(hunk);

        return html`
            <div class="hunk">
                <div class="hunk-header" @click=${() => this.toggleHunk(hunk)}>
                    <input
                        id="hunk-cb-${hunk.index}"
                        type="checkbox"
                        .checked=${checked}
                        @click=${(e: Event) => {
                            e.stopPropagation();
                            this.toggleHunk(hunk);
                        }}
                    />
                    <span>@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@</span>
                    ${hunk.contextHint ? html`<span class="hint">${hunk.contextHint}</span>` : ''}
                </div>
                ${hunk.lines.map(line => {
                    const isChange = line.type !== 'context';
                    const isChecked = this.isLineChecked(hunk, line.index);
                    const dimmed = isChange && !isChecked;

                    return html`
                        <div class="line line-${line.type} ${dimmed ? 'line-dimmed' : ''}">
                            <div class="line-checkbox-cell">
                                ${isChange
                                    ? html`<input
                                          type="checkbox"
                                          .checked=${isChecked}
                                          @click=${(e: Event) => {
                                              e.stopPropagation();
                                              this.toggleLine(hunk, line.index);
                                          }}
                                      />`
                                    : ''}
                            </div>
                            <span class="line-prefix"
                                >${line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}</span
                            >
                            <span class="line-content">${line.content}</span>
                        </div>
                    `;
                })}
            </div>
        `;
    }
}

customElements.define('yogit-diff', YogitDiff);
