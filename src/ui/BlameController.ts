import { API, Repository } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';
import { getBlameConfig } from '../config';
import { BlameLine, blameLine, getUserEmail } from '../git/blame';

/** Longueur max du sujet du commit repris dans l'annotation de fin de ligne. */
const SUMMARY_MAX = 50;

interface DocumentCache {
    version: number;
    /** Ligne (0-based) → blame, ou null quand la ligne n'est pas attribuable. */
    lines: Map<number, BlameLine | null>;
}

/**
 * Blame de la ligne courante : annotation discrète en fin de ligne + entrée dans la
 * barre d'état, toutes deux mises à jour au fil du curseur.
 *
 * Le blame est demandé ligne par ligne (`git blame -L n,n`) plutôt que fichier entier :
 * le coût reste constant quelle que soit la taille du fichier, ce qui compte pour une
 * lecture relancée à chaque déplacement du curseur. Un cache par (document, version)
 * évite de relancer git sur les lignes déjà visitées.
 */
export class BlameController implements vscode.Disposable {
    private readonly _decoration = vscode.window.createTextEditorDecorationType({
        // Sans ClosedOpen, taper en fin de ligne pousserait l'annotation dans le texte saisi.
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
    });
    private readonly _statusBar: vscode.StatusBarItem;
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _cache = new Map<string, DocumentCache>();
    private readonly _emailByRepo = new Map<string, Promise<string>>();

    private _timer: NodeJS.Timeout | undefined;
    /** Incrémenté à chaque demande : une réponse git plus ancienne que ce jeton est ignorée. */
    private _requestId = 0;
    private _current: BlameLine | undefined;
    private _repoListener: vscode.Disposable | undefined;

    constructor(private readonly _gitApi: API) {
        this._statusBar = vscode.window.createStatusBarItem('yorgit.blame', vscode.StatusBarAlignment.Left, -10);
        this._statusBar.name = 'YorGit Blame';
        this._statusBar.command = 'haerphi-yorgit.blame-show-commit';

        this._disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => this._schedule()),
            vscode.window.onDidChangeTextEditorSelection(e => {
                if (e.textEditor === vscode.window.activeTextEditor) {
                    this._schedule();
                }
            }),
            vscode.workspace.onDidChangeTextDocument(e => {
                this._cache.delete(e.document.uri.toString());
                if (e.document === vscode.window.activeTextEditor?.document) {
                    this._schedule();
                }
            }),
            vscode.workspace.onDidCloseTextDocument(doc => this._cache.delete(doc.uri.toString())),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('haerphi-yorgit.blame')) {
                    this._schedule();
                }
            }),
            this._gitApi.onDidOpenRepository(() => this._watchRepository()),
        );

        this._watchRepository();
        this._schedule();
    }

    /** Blame affiché pour la ligne courante, lu par les commandes de la barre d'état. */
    get current(): BlameLine | undefined {
        return this._current;
    }

    dispose(): void {
        if (this._timer) {
            clearTimeout(this._timer);
        }
        this._repoListener?.dispose();
        this._disposables.forEach(d => d.dispose());
        this._decoration.dispose();
        this._statusBar.dispose();
    }

    /**
     * Un commit, un rebase ou un stash réécrit l'attribution de lignes déjà en cache —
     * il n'existe pas de granularité plus fine que « tout invalider » côté API git.
     */
    private _watchRepository(): void {
        const repo = this._gitApi.repositories[0];
        if (!repo) {
            return;
        }
        this._repoListener?.dispose();
        this._repoListener = repo.state.onDidChange(() => {
            this._cache.clear();
            this._schedule();
        });
    }

    private _schedule(): void {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = undefined;
        }

        const target = this._resolveTarget();
        if (!target) {
            this._clear();
            return;
        }

        // Une ligne déjà en cache est rendue sans délai : se déplacer dans une zone
        // déjà visitée ne doit pas faire clignoter l'annotation.
        const cached = this._cache.get(target.document.uri.toString());
        if (cached?.version === target.document.version && cached.lines.has(target.line)) {
            this._requestId += 1;
            this._render(target.editor, target.line, cached.lines.get(target.line) ?? undefined);
            return;
        }

        // L'annotation de la ligne précédente serait trompeuse sur la nouvelle ligne, on la
        // retire tout de suite ; la barre d'état, elle, garde sa valeur jusqu'à la réponse
        // (elle est loin du curseur, la remplacer sans la faire disparaître évite le clignotement).
        this._setDecoration(target.editor, undefined, 0);

        const { delay } = getBlameConfig();
        this._timer = setTimeout(
            () => {
                this._timer = undefined;
                void this._update(target.editor, target.line);
            },
            Math.max(0, delay),
        );
    }

    /** Éditeur/ligne à blâmer, ou undefined si le contexte ne s'y prête pas. */
    private _resolveTarget():
        | { editor: vscode.TextEditor; document: vscode.TextDocument; repo: Repository; line: number }
        | undefined {
        const { inline, statusBar } = getBlameConfig();
        if (!inline && !statusBar) {
            return undefined;
        }

        const editor = vscode.window.activeTextEditor;
        // Les schémas non-`file` (git:, output:, volet de diff…) n'ont pas de contenu
        // attribuable : un blame y renverrait l'attribution d'une révision figée.
        if (!editor || editor.document.uri.scheme !== 'file' || editor.document.isUntitled) {
            return undefined;
        }

        const repo = this._gitApi.getRepository(editor.document.uri);
        if (!repo) {
            return undefined;
        }

        return { editor, document: editor.document, repo, line: editor.selection.active.line };
    }

    private async _update(editor: vscode.TextEditor, line: number): Promise<void> {
        const target = this._resolveTarget();
        // Le curseur a pu bouger pendant le délai — on ne blâme que ce qui est encore visé.
        if (!target || target.editor !== editor || target.line !== line) {
            return;
        }

        const requestId = ++this._requestId;
        const { document, repo } = target;
        const version = document.version;

        let result: BlameLine | undefined;
        try {
            result = await blameLine(
                this._gitApi.git.path,
                repo.rootUri.fsPath,
                document.uri.fsPath,
                line + 1,
                document.isDirty ? document.getText() : undefined,
            );
        } catch {
            // Fichier non suivi, hors index, ligne au-delà de la fin : rien à annoter.
            result = undefined;
        }

        if (requestId !== this._requestId) {
            return;
        }

        const key = document.uri.toString();
        const cached = this._cache.get(key);
        const entry = cached?.version === version ? cached : { version, lines: new Map<number, BlameLine | null>() };
        entry.lines.set(line, result ?? null);
        this._cache.set(key, entry);

        // Le document a pu être modifié pendant l'appel git : le résultat porte alors sur
        // un contenu périmé, on le garde en cache (clé versionnée) mais on ne l'affiche pas.
        if (document.version !== version || vscode.window.activeTextEditor !== editor) {
            return;
        }

        this._render(editor, line, result);
    }

    private _render(editor: vscode.TextEditor, line: number, blame: BlameLine | undefined): void {
        this._current = blame;
        void vscode.commands.executeCommand('setContext', 'haerphi-yorgit.hasBlame', blame !== undefined);

        if (!blame) {
            this._clear();
            return;
        }

        void this._decorate(editor, line, blame);
    }

    private async _decorate(editor: vscode.TextEditor, line: number, blame: BlameLine): Promise<void> {
        const { inline, statusBar } = getBlameConfig();
        const repo = this._gitApi.getRepository(editor.document.uri);
        const isSelf = repo ? await this._isSelf(repo, blame) : false;
        // `_isSelf` peut avoir rendu la main après un nouveau déplacement du curseur.
        if (this._current !== blame) {
            return;
        }
        const who = blame.uncommitted || isSelf ? vscode.l10n.t('You') : blame.author;

        // Une sélection en cours ou plusieurs curseurs : l'annotation gênerait la lecture
        // du texte sélectionné plus qu'elle n'informe.
        const idle = editor.selections.length === 1 && editor.selection.isEmpty;
        this._setDecoration(editor, inline && idle ? this._inlineText(who, blame) : undefined, line);

        if (!statusBar) {
            this._statusBar.hide();
            return;
        }
        this._statusBar.text = `$(git-commit) ${who}, ${this._when(blame)}`;
        this._statusBar.tooltip = this._tooltip(who, blame);
        this._statusBar.show();
    }

    private _inlineText(who: string, blame: BlameLine): string {
        if (blame.uncommitted) {
            return vscode.l10n.t('{0}, uncommitted changes', who);
        }
        const summary =
            blame.summary.length > SUMMARY_MAX ? `${blame.summary.slice(0, SUMMARY_MAX).trimEnd()}…` : blame.summary;
        return `${who}, ${this._when(blame)}${summary ? ` • ${summary}` : ''}`;
    }

    private _tooltip(who: string, blame: BlameLine): vscode.MarkdownString {
        const md = new vscode.MarkdownString(undefined, true);
        // Les liens `command:` d'une tooltip ne sont exécutables que sur un MarkdownString de confiance.
        md.isTrusted = { enabledCommands: ['haerphi-yorgit.blame-show-commit', 'haerphi-yorgit.copy-blame-hash'] };
        md.supportThemeIcons = true;

        if (blame.uncommitted) {
            md.appendMarkdown(`$(git-commit) ${vscode.l10n.t('{0}, uncommitted changes', who)}`);
            return md;
        }

        const mail = blame.authorMail ? ` <${blame.authorMail}>` : '';
        md.appendMarkdown(`**${escapeMarkdown(blame.summary)}**\n\n`);
        md.appendMarkdown(`${escapeMarkdown(blame.author)}${escapeMarkdown(mail)} — ${this._absolute(blame)}\n\n`);
        md.appendMarkdown(`\`${blame.shortHash}\`\n\n`);
        md.appendMarkdown(
            `[${vscode.l10n.t('Show commit')}](command:haerphi-yorgit.blame-show-commit) · ` +
                `[${vscode.l10n.t('Copy hash')}](command:haerphi-yorgit.copy-blame-hash)`,
        );
        return md;
    }

    private _setDecoration(editor: vscode.TextEditor, text: string | undefined, line: number): void {
        // Les décorations sont posées par éditeur : sans ce nettoyage, un panneau resté
        // ouvert côte à côte garderait l'annotation de sa dernière ligne active.
        vscode.window.visibleTextEditors.forEach(e => {
            if (e !== editor) {
                e.setDecorations(this._decoration, []);
            }
        });

        if (text === undefined || line >= editor.document.lineCount) {
            editor.setDecorations(this._decoration, []);
            return;
        }
        const end = editor.document.lineAt(line).range.end;
        editor.setDecorations(this._decoration, [
            {
                range: new vscode.Range(end, end),
                renderOptions: {
                    after: {
                        contentText: text,
                        margin: '0 0 0 3em',
                        color: new vscode.ThemeColor('editorCodeLens.foreground'),
                        fontStyle: 'italic',
                    },
                },
            },
        ]);
    }

    private _clear(): void {
        this._current = undefined;
        void vscode.commands.executeCommand('setContext', 'haerphi-yorgit.hasBlame', false);
        this._statusBar.hide();
        vscode.window.visibleTextEditors.forEach(e => e.setDecorations(this._decoration, []));
    }

    /** L'auteur de la ligne est-il l'utilisateur courant ? (comparaison sur user.email) */
    private async _isSelf(repo: Repository, blame: BlameLine): Promise<boolean> {
        if (!blame.authorMail) {
            return false;
        }
        const cwd = repo.rootUri.fsPath;
        let email = this._emailByRepo.get(cwd);
        if (!email) {
            email = getUserEmail(this._gitApi.git.path, cwd);
            this._emailByRepo.set(cwd, email);
        }
        return (await email) === blame.authorMail;
    }

    private _when(blame: BlameLine): string {
        return formatRelative(blame.authorTime * 1000);
    }

    private _absolute(blame: BlameLine): string {
        return new Date(blame.authorTime * 1000).toLocaleString(vscode.env.language, {
            dateStyle: 'long',
            timeStyle: 'short',
        });
    }
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 24 * 3600],
    ['month', 30 * 24 * 3600],
    ['week', 7 * 24 * 3600],
    ['day', 24 * 3600],
    ['hour', 3600],
    ['minute', 60],
];

/**
 * Date relative localisée ("2 days ago", « il y a 2 jours »).
 *
 * Passe par Intl plutôt que par le bundle l10n : les règles de pluriel et l'ordre des
 * mots varient par langue, et Intl suit vscode.env.language — la même langue que
 * `vscode.l10n.t()` côté extension host.
 */
function formatRelative(timestampMs: number): string {
    const seconds = (Date.now() - timestampMs) / 1000;
    const rtf = new Intl.RelativeTimeFormat(vscode.env.language, { numeric: 'auto' });
    for (const [unit, size] of UNITS) {
        if (Math.abs(seconds) >= size) {
            return rtf.format(-Math.round(seconds / size), unit);
        }
    }
    return rtf.format(-Math.round(seconds), 'second');
}

/** Neutralise les caractères markdown d'un texte issu de git (auteur, sujet de commit). */
function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
