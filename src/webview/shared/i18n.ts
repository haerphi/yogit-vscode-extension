/**
 * i18n minimaliste pour les webviews.
 *
 * L'API vscode.l10n n'est pas disponible dans les webviews : l'extension host
 * injecte la langue de VS Code via `window.__YOGIT_LOCALE__` (script inline
 * dans le shell HTML). Chaque composant définit un dictionnaire anglais et sa
 * traduction française, et choisit via pick().
 */
export function isFrench(): boolean {
    const w = window as typeof window & { __YOGIT_LOCALE__?: string };
    const lang = (w.__YOGIT_LOCALE__ ?? navigator.language ?? '').toLowerCase();
    return lang.startsWith('fr');
}

export function pick<T>(en: T, fr: T): T {
    return isFrench() ? fr : en;
}
