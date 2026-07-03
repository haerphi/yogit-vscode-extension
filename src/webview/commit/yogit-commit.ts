import { LitElement, css, html, nothing } from 'lit';
import { pick } from '../shared/i18n';

declare global {
    interface Window {
        acquireVsCodeApi: () => { postMessage: (msg: unknown) => void };
    }
}

const vscode = window.acquireVsCodeApi();

const L = pick(
    {
        rebaseInProgress: 'Rebase in progress',
        rebaseOf: 'Rebasing',
        rebaseOnto: 'onto',
        continueRebase: 'Continue rebase',
        abortRebase: 'Abort rebase',
        filesAdded: (n: number) => `${n} file${n > 1 ? 's' : ''} added`,
        filesStaged: (n: number) => `${n} file${n > 1 ? 's' : ''} staged`,
        messageOnly: 'Message only',
        noStagedFiles: 'No staged files',
        committing: 'Commit…',
        amendButton: 'Amend',
        commitButton: 'Commit',
        detachedWarning: '⚠ Detached HEAD — create a branch to avoid losing your commits.',
        createBranch: '+ Create branch',
        titlePlaceholder: 'Commit title',
        descriptionPlaceholder: 'Description (optional)',
        amendLabel: 'Amend last commit',
    },
    {
        rebaseInProgress: 'Rebase en cours',
        rebaseOf: 'Rebasage de',
        rebaseOnto: 'sur',
        continueRebase: 'Continuer le rebase',
        abortRebase: 'Annuler le rebase',
        filesAdded: (n: number) => `${n} fichier${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''}`,
        filesStaged: (n: number) => `${n} fichier${n > 1 ? 's' : ''} indexé${n > 1 ? 's' : ''}`,
        messageOnly: 'Message seulement',
        noStagedFiles: 'Aucun fichier indexé',
        committing: 'Commit…',
        amendButton: 'Amender',
        commitButton: 'Commit',
        detachedWarning: '⚠ HEAD détachée — créez une branche pour ne pas perdre vos commits.',
        createBranch: '+ Créer une branche',
        titlePlaceholder: 'Titre du commit',
        descriptionPlaceholder: 'Description (optionnel)',
        amendLabel: 'Amender le dernier commit',
    },
);

interface LastCommit {
    hash: string;
    title: string;
    description: string;
}

interface RebaseState {
    step: number;
    total: number;
    branch: string;
    onto: string;
}

type ProviderMessage =
    | {
          type: 'update';
          stagedCount: number;
          lastCommit: LastCommit | null;
          detachedHead: boolean;
          rebaseState: RebaseState | null;
      }
    | { type: 'committed' }
    | { type: 'error'; message: string };

export class YogitCommit extends LitElement {
    static properties = {
        title: { type: String },
        description: { type: String },
        stagedCount: { type: Number },
        amend: { type: Boolean },
        lastCommit: { type: Object },
        committing: { type: Boolean },
        errorMessage: { type: String },
        detachedHead: { type: Boolean },
        rebaseState: { type: Object },
    };

    declare title: string;
    declare description: string;
    declare stagedCount: number;
    declare amend: boolean;
    declare lastCommit: LastCommit | null;
    declare committing: boolean;
    declare errorMessage: string;
    declare detachedHead: boolean;
    declare rebaseState: RebaseState | null;

    constructor() {
        super();
        this.title = '';
        this.description = '';
        this.stagedCount = 0;
        this.amend = false;
        this.lastCommit = null;
        this.committing = false;
        this.errorMessage = '';
        this.detachedHead = false;
        this.rebaseState = null;
    }

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener('message', (event: MessageEvent<ProviderMessage>) => {
            const msg = event.data;
            if (msg.type === 'update') {
                this.stagedCount = msg.stagedCount;
                this.lastCommit = msg.lastCommit;
                this.detachedHead = msg.detachedHead;
                this.rebaseState = msg.rebaseState ?? null;
            } else if (msg.type === 'committed') {
                this.title = '';
                this.description = '';
                this.amend = false;
                this.committing = false;
                this.errorMessage = '';
            } else if (msg.type === 'error') {
                this.committing = false;
                this.errorMessage = msg.message;
            }
        });
        vscode.postMessage({ type: 'ready' });
    }

    private toggleAmend() {
        this.amend = !this.amend;
        if (this.amend && this.lastCommit) {
            this.title = this.lastCommit.title;
            this.description = this.lastCommit.description;
        }
        this.errorMessage = '';
    }

    private doCommit() {
        const canCommit = this.amend
            ? this.title.trim().length > 0
            : this.title.trim().length > 0 && this.stagedCount > 0;
        if (!canCommit || this.committing) {
            return;
        }
        this.committing = true;
        this.errorMessage = '';
        vscode.postMessage({
            type: 'commit',
            title: this.title.trim(),
            description: this.description.trim(),
            amend: this.amend,
        });
    }

    static styles = css`
        :host {
            display: block;
            padding: 8px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
        }

        .title-input,
        .description-input {
            display: block;
            width: 100%;
            box-sizing: border-box;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            outline: none;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            padding: 4px 6px;
            border-radius: 2px;
            resize: none;
        }

        .title-input:focus,
        .description-input:focus {
            border-color: var(--vscode-focusBorder);
        }

        .title-input {
            margin-bottom: 6px;
        }

        .description-input {
            height: 72px;
            margin-bottom: 8px;
        }

        .amend-row {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 8px;
            cursor: pointer;
            user-select: none;
        }

        .amend-row input[type='checkbox'] {
            accent-color: var(--vscode-checkbox-background);
            width: 13px;
            height: 13px;
            cursor: pointer;
            flex-shrink: 0;
        }

        .amend-label {
            font-size: 11px;
            color: var(--vscode-foreground);
            flex: 1;
        }

        .amend-hash {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            font-family: var(--vscode-editor-font-family, monospace);
        }

        .footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }

        .staged-count {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .staged-count.warn {
            color: var(--vscode-errorForeground);
        }

        .btn-commit {
            flex-shrink: 0;
            padding: 3px 10px;
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 12px;
            font-family: var(--vscode-font-family);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn-commit:hover:not(:disabled) {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-commit:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .error {
            font-size: 11px;
            color: var(--vscode-errorForeground);
            margin-bottom: 6px;
            word-break: break-word;
        }

        .detached-warning {
            font-size: 11px;
            color: var(--vscode-editorWarning-foreground, #e09a4e);
            background: rgba(224, 154, 78, 0.12);
            border: 1px solid var(--vscode-editorWarning-foreground, #e09a4e);
            border-radius: 3px;
            padding: 6px 8px;
            margin-bottom: 6px;
            line-height: 1.4;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
        }

        .detached-warning span {
            flex: 1;
        }

        .btn-create-branch {
            flex-shrink: 0;
            padding: 3px 8px;
            font-size: 11px;
            font-family: var(--vscode-font-family);
            cursor: pointer;
            border-radius: 3px;
            border: 1px solid var(--vscode-editorWarning-foreground, #e09a4e);
            background: transparent;
            color: var(--vscode-editorWarning-foreground, #e09a4e);
            white-space: nowrap;
        }

        .btn-create-branch:hover {
            background: rgba(224, 154, 78, 0.2);
        }

        /* ── Panneau rebase en cours ─────────────────────────────────────── */
        .rebase-panel {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .rebase-header {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 7px 8px;
            border-radius: 3px;
            background: rgba(224, 154, 78, 0.12);
            border: 1px solid var(--vscode-editorWarning-foreground, #e09a4e);
        }

        .rebase-icon {
            font-size: 14px;
        }

        .rebase-title {
            font-size: 12px;
            font-weight: 600;
            color: var(--vscode-editorWarning-foreground, #e09a4e);
            flex: 1;
        }

        .rebase-progress {
            font-size: 11px;
            font-family: var(--vscode-editor-font-family, monospace);
            color: var(--vscode-editorWarning-foreground, #e09a4e);
            opacity: 0.85;
        }

        .rebase-info {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            padding: 0 2px;
            line-height: 1.5;
        }

        .rebase-branch {
            font-family: var(--vscode-editor-font-family, monospace);
            color: var(--vscode-foreground);
        }

        .rebase-actions {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .btn-continue {
            width: 100%;
            padding: 6px 10px;
            border-radius: 3px;
            border: none;
            cursor: pointer;
            font-size: 12px;
            font-family: var(--vscode-font-family);
            font-weight: 600;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn-continue:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-abort {
            width: 100%;
            padding: 6px 10px;
            border-radius: 3px;
            border: 1px solid var(--vscode-errorForeground, #e04e4e);
            cursor: pointer;
            font-size: 12px;
            font-family: var(--vscode-font-family);
            font-weight: 600;
            background: rgba(224, 78, 78, 0.1);
            color: var(--vscode-errorForeground, #e04e4e);
        }

        .btn-abort:hover {
            background: rgba(224, 78, 78, 0.2);
        }

        .rebase-error {
            font-size: 11px;
            color: var(--vscode-errorForeground);
            word-break: break-word;
            padding: 0 2px;
        }
    `;

    private _renderRebasePanel(rb: RebaseState) {
        const hasProgress = rb.total > 0;
        return html`
            <div class="rebase-panel">
                <div class="rebase-header">
                    <span class="rebase-icon">⟳</span>
                    <span class="rebase-title">${L.rebaseInProgress}</span>
                    ${hasProgress ? html`<span class="rebase-progress">${rb.step} / ${rb.total}</span>` : nothing}
                </div>
                ${rb.branch || rb.onto
                    ? html`<div class="rebase-info">
                          ${L.rebaseOf} <span class="rebase-branch">${rb.branch || '…'}</span> ${L.rebaseOnto}
                          <span class="rebase-branch">${rb.onto || '…'}</span>
                      </div>`
                    : nothing}
                ${this.errorMessage ? html`<div class="rebase-error">⚠ ${this.errorMessage}</div>` : nothing}
                <div class="rebase-actions">
                    <button class="btn-continue" @click=${() => vscode.postMessage({ type: 'continue-rebase' })}>
                        ▶ ${L.continueRebase}
                    </button>
                    <button class="btn-abort" @click=${() => vscode.postMessage({ type: 'abort-rebase' })}>
                        ✕ ${L.abortRebase}
                    </button>
                </div>
            </div>
        `;
    }

    render() {
        if (this.rebaseState) {
            return this._renderRebasePanel(this.rebaseState);
        }

        const canCommit = this.amend
            ? this.title.trim().length > 0 && !this.committing
            : this.title.trim().length > 0 && this.stagedCount > 0 && !this.committing;

        const stagedLabel = this.amend
            ? this.stagedCount > 0
                ? L.filesAdded(this.stagedCount)
                : L.messageOnly
            : this.stagedCount === 0
              ? L.noStagedFiles
              : L.filesStaged(this.stagedCount);

        const stagedWarn = !this.amend && this.stagedCount === 0;
        const buttonLabel = this.committing ? L.committing : this.amend ? L.amendButton : L.commitButton;

        return html`
            ${this.detachedHead
                ? html`<div class="detached-warning">
                      <span>${L.detachedWarning}</span>
                      <button class="btn-create-branch" @click=${() => vscode.postMessage({ type: 'create-branch' })}>
                          ${L.createBranch}
                      </button>
                  </div>`
                : ''}
            <input
                class="title-input"
                type="text"
                placeholder=${L.titlePlaceholder}
                .value=${this.title}
                @input=${(e: InputEvent) => {
                    this.title = (e.target as HTMLInputElement).value;
                }}
                @keydown=${(e: KeyboardEvent) => {
                    if (e.key === 'Enter' && canCommit) {
                        this.doCommit();
                    }
                }}
            />
            <textarea
                class="description-input"
                placeholder=${L.descriptionPlaceholder}
                .value=${this.description}
                @input=${(e: InputEvent) => {
                    this.description = (e.target as HTMLTextAreaElement).value;
                }}
            ></textarea>
            ${this.errorMessage ? html`<div class="error">${this.errorMessage}</div>` : ''}
            <div class="amend-row" @click=${this.toggleAmend}>
                <input type="checkbox" .checked=${this.amend} @click=${(e: Event) => e.stopPropagation()} />
                <span class="amend-label">${L.amendLabel}</span>
                ${this.lastCommit ? html`<span class="amend-hash">${this.lastCommit.hash}</span>` : ''}
            </div>
            <div class="footer">
                <span class="staged-count ${stagedWarn ? 'warn' : ''}">${stagedLabel}</span>
                <button class="btn-commit" ?disabled=${!canCommit} @click=${this.doCommit}>${buttonLabel}</button>
            </div>
        `;
    }
}

customElements.define('yogit-commit', YogitCommit);
