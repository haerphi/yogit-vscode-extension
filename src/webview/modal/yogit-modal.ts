import { LitElement, css, html } from 'lit';
import type { ModalOptions } from '../../types/modal';

// acquireVsCodeApi() est injecté par le runtime webview VS Code.
// On l'appelle une seule fois au niveau du module — l'API ne peut être acquise qu'une fois.
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();

/**
 * Composant Lit <yogit-modal> — rendu de la modale de confirmation.
 *
 * Les options (titre, message, boutons, checkboxes) sont passées par l'extension host
 * via `window.__YOGIT_OPTIONS__` (injecté dans le HTML avant le chargement de ce script).
 * Le composant les lit dans connectedCallback() et les stocke comme propriété réactive.
 *
 * Réponse : un clic sur un bouton envoie un message à l'extension host via postMessage().
 * L'extension host reçoit soit `{ cancel: true }` soit `{ button, checkboxes }`.
 */
class YogitModal extends LitElement {
    static properties = {
        options: { type: Object },
        selectValues: { state: true },
    };

    options: ModalOptions | null = null;

    // Valeur courante de chaque liste déroulante — état réactif pour que le bandeau
    // warning de l'option sélectionnée apparaisse/disparaisse au changement.
    selectValues: Record<string, string> = {};

    static styles = css`
        :host {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 24px;
            box-sizing: border-box;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
        }

        *,
        *::before,
        *::after {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        .modal {
            background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
            border: 1px solid var(--vscode-editorWidget-border, var(--vscode-focusBorder));
            border-radius: 6px;
            width: 100%;
            max-width: 480px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            overflow: hidden;
        }

        .modal__header {
            padding: 20px 24px 0;
        }

        .modal__title {
            font-size: 1.1em;
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .modal__body {
            padding: 16px 24px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .message {
            color: var(--vscode-foreground);
            line-height: 1.5;
        }

        .detail {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
            line-height: 1.5;
        }

        .warning-banner {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 12%, transparent);
            border: 1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground) 40%, transparent);
            border-radius: 4px;
            padding: 10px 12px;
            color: var(--vscode-foreground);
            font-size: 0.9em;
            line-height: 1.5;
        }

        .warning-icon {
            color: var(--vscode-editorWarning-foreground);
            font-size: 1.1em;
            flex-shrink: 0;
            margin-top: 1px;
        }

        .inputs {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .input-field {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .input-field label {
            color: var(--vscode-foreground);
            font-size: 0.9em;
        }

        .input-field input[type='text'] {
            padding: 5px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            border-radius: 3px;
            font-size: var(--vscode-font-size);
            font-family: var(--vscode-font-family);
            outline: none;
        }

        .input-field input[type='text']:focus {
            border-color: var(--vscode-focusBorder);
        }

        .input-field input[type='text']::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }

        .selects {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .select-field {
            display: grid;
            grid-template-columns: minmax(70px, auto) 1fr;
            align-items: center;
            gap: 10px;
        }

        .select-field label {
            color: var(--vscode-foreground);
            font-size: 0.9em;
            text-align: right;
        }

        .select-field select {
            padding: 4px 8px;
            background: var(--vscode-dropdown-background, var(--vscode-input-background));
            color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
            border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
            border-radius: 3px;
            font-size: var(--vscode-font-size);
            font-family: var(--vscode-font-family);
            outline: none;
            width: 100%;
        }

        .select-field select:focus {
            border-color: var(--vscode-focusBorder);
        }

        .checkboxes {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .checkbox {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            color: var(--vscode-foreground);
            font-size: 0.95em;
        }

        .checkbox input[type='checkbox'] {
            width: 14px;
            height: 14px;
            accent-color: var(--vscode-button-background);
            cursor: pointer;
            flex-shrink: 0;
        }

        .modal__footer {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            padding: 12px 24px 20px;
            border-top: 1px solid var(--vscode-editorWidget-border, var(--vscode-focusBorder));
        }

        .btn {
            padding: 6px 16px;
            border: none;
            border-radius: 3px;
            font-size: var(--vscode-font-size);
            font-family: var(--vscode-font-family);
            cursor: pointer;
            transition: opacity 0.1s;
        }

        .btn:hover {
            opacity: 0.9;
        }
        .btn:active {
            opacity: 0.75;
        }

        .btn--primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn--secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn--danger {
            background: var(--vscode-errorForeground);
            color: #fff;
        }
    `;

    connectedCallback() {
        super.connectedCallback();
        // Les options sont injectées dans window avant le chargement de ce script.
        const w = window as typeof window & { __YOGIT_OPTIONS__?: ModalOptions };
        if (w.__YOGIT_OPTIONS__) {
            this.options = w.__YOGIT_OPTIONS__;
            const values: Record<string, string> = {};
            for (const select of this.options.selects ?? []) {
                values[select.id] = select.value ?? select.options[0]?.value ?? '';
            }
            this.selectValues = values;
        }
    }

    /** Warnings des options actuellement sélectionnées dans les listes déroulantes. */
    private get activeSelectWarnings(): string[] {
        return (this.options?.selects ?? [])
            .map(select => select.options.find(opt => opt.value === this.selectValues[select.id])?.warning)
            .filter((warning): warning is string => warning !== undefined)
            .map(warning => this.interpolate(warning));
    }

    /**
     * Remplace les jetons `${id}` d'un libellé par la valeur courante du select
     * portant cet id — ex: un select "remote" peut afficher "origin/${branch}" pour
     * suivre en direct le select "branch" sans dépendance figée à l'ouverture de la modale.
     */
    private interpolate(text: string): string {
        return text.replace(/\$\{(\w+)\}/g, (_, id: string) => this.selectValues[id] ?? '');
    }

    private handleSelectChange(e: Event) {
        const select = e.target as HTMLSelectElement;
        this.selectValues = { ...this.selectValues, [select.id]: select.value };
    }

    render() {
        if (!this.options) {
            return html``;
        }
        const o = this.options;

        return html`
            <div class="modal">
                <div class="modal__header">
                    <h2 class="modal__title">${o.title}</h2>
                </div>
                <div class="modal__body">
                    <p class="message">${o.message}</p>
                    ${[...(o.warning ? [o.warning] : []), ...this.activeSelectWarnings].map(
                        warning => html`
                            <div class="warning-banner">
                                <span class="warning-icon">⚠</span>
                                <span>${warning}</span>
                            </div>
                        `,
                    )}
                    ${o.detail ? html`<p class="detail">${o.detail}</p>` : ''}
                    ${o.selects?.length
                        ? html`
                              <div class="selects">
                                  ${o.selects.map(
                                      select => html`
                                          <div class="select-field">
                                              <label for=${select.id}>${select.label}</label>
                                              <select id=${select.id} @change=${this.handleSelectChange}>
                                                  ${select.options.map(
                                                      opt => html`
                                                          <option
                                                              value=${opt.value}
                                                              ?selected=${opt.value === this.selectValues[select.id]}
                                                          >
                                                              ${this.interpolate(opt.label)}
                                                          </option>
                                                      `,
                                                  )}
                                              </select>
                                          </div>
                                      `,
                                  )}
                              </div>
                          `
                        : ''}
                    ${o.inputs?.length
                        ? html`
                              <div class="inputs">
                                  ${o.inputs.map(
                                      input => html`
                                          <div class="input-field">
                                              <label for=${input.id}>${input.label}</label>
                                              <input
                                                  type="text"
                                                  id=${input.id}
                                                  placeholder=${input.placeholder ?? ''}
                                                  .value=${input.value ?? ''}
                                                  @keydown=${this.handleInputKeydown}
                                              />
                                          </div>
                                      `,
                                  )}
                              </div>
                          `
                        : ''}
                    ${o.checkboxes?.length
                        ? html`
                              <div class="checkboxes">
                                  ${o.checkboxes.map(
                                      cb => html`
                                          <label class="checkbox">
                                              <input type="checkbox" id=${cb.id} ?checked=${cb.checked ?? false} />
                                              <span>${cb.label}</span>
                                          </label>
                                      `,
                                  )}
                              </div>
                          `
                        : ''}
                </div>
                <div class="modal__footer" @click=${this.handleFooterClick}>
                    ${o.buttons.map(
                        btn => html`
                            <button class="btn btn--${btn.variant ?? 'secondary'}" data-value=${btn.value}>
                                ${btn.label}
                            </button>
                        `,
                    )}
                </div>
            </div>
        `;
    }

    firstUpdated() {
        this.renderRoot.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
    }

    private handleInputKeydown(e: KeyboardEvent) {
        if (e.key !== 'Enter') {
            return;
        }
        // Entrée dans un champ texte = clic sur le bouton primaire (s'il existe).
        const primary = this.options?.buttons.find(b => b.variant === 'primary');
        if (primary) {
            this.submit(primary.value);
        }
    }

    private handleFooterClick(e: Event) {
        const btn = (e.target as Element).closest<HTMLElement>('[data-value]');
        if (!btn?.dataset['value']) {
            return;
        }
        this.submit(btn.dataset['value']);
    }

    private submit(buttonValue: string) {
        if (buttonValue === 'cancel') {
            vscode.postMessage({ cancel: true });
            return;
        }

        // Lit expose le shadow root via this.renderRoot.
        // On collecte l'état de toutes les checkboxes et champs texte au moment du clic.
        const checkboxes: Record<string, boolean> = {};
        this.renderRoot.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => {
            checkboxes[cb.id] = cb.checked;
        });
        const inputs: Record<string, string> = {};
        this.renderRoot.querySelectorAll<HTMLInputElement>('input[type="text"]').forEach(input => {
            inputs[input.id] = input.value;
        });
        const selects: Record<string, string> = {};
        this.renderRoot.querySelectorAll<HTMLSelectElement>('select').forEach(select => {
            selects[select.id] = select.value;
        });

        vscode.postMessage({ button: buttonValue, checkboxes, inputs, selects });
    }
}

customElements.define('yogit-modal', YogitModal);
