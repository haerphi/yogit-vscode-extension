import { Repository } from '@haerphi/vscode-git-api-types';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { resolveWebviewLocale } from '../config';
import { getGitOutputChannel, runGit } from '../git/git-exec';

type WebviewMessage =
    | { type: 'ready' }
    | { type: 'commit'; title: string; description: string; amend: boolean }
    | { type: 'create-branch' }
    | { type: 'abort-rebase' }
    | { type: 'continue-rebase' }
    | { type: 'push' }
    | { type: 'pull' };

export interface LastCommit {
    hash: string;
    title: string;
    description: string;
}

export interface RebaseState {
    step: number;
    total: number;
    branch: string;
    onto: string;
}

/**
 * WebviewViewProvider pour le formulaire de commit (sidebar).
 *
 * Contrairement à WebviewPanel, un WebviewViewProvider vit dans la sidebar —
 * resolveWebviewView() est appelé une fois lors de la première révélation.
 * La communication est bidirectionnelle :
 *   - provider → webview : update { stagedCount, lastCommit } (temps réel), committed, error
 *   - webview → provider : ready (composant Lit monté), commit { title, description, amend }
 */
export class CommitView implements vscode.WebviewViewProvider {
    private _webviewView: vscode.WebviewView | undefined;
    private _repo: Repository | undefined;
    private _gitPath: string | undefined;
    private _repoStateListener: vscode.Disposable | undefined;

    constructor(private readonly _context: vscode.ExtensionContext) {}

    setRepository(repo: Repository, gitPath: string): void {
        this._repoStateListener?.dispose();
        this._repo = repo;
        this._gitPath = gitPath;
        this._repoStateListener = repo.state.onDidChange(() => {
            this._sendUpdate();
        });
        this._sendUpdate();
    }

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this._webviewView = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'out', 'webview')],
        };
        webviewView.webview.html = this._buildHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
            if (msg.type === 'ready') {
                this._sendUpdate();
            } else if (msg.type === 'commit') {
                await this._doCommit(msg.title, msg.description, msg.amend);
            } else if (msg.type === 'create-branch') {
                vscode.commands.executeCommand('haerphi-yogit.create-branch');
            } else if (msg.type === 'abort-rebase') {
                vscode.commands.executeCommand('haerphi-yogit.abort-rebase');
            } else if (msg.type === 'continue-rebase') {
                vscode.commands.executeCommand('haerphi-yogit.continue-rebase');
            } else if (msg.type === 'push') {
                vscode.commands.executeCommand('haerphi-yogit.push');
            } else if (msg.type === 'pull') {
                vscode.commands.executeCommand('haerphi-yogit.pull');
            }
        });
    }

    private async _sendUpdate(): Promise<void> {
        if (!this._webviewView || !this._repo) {
            return;
        }
        const stagedCount = this._repo.state.indexChanges.length;
        const lastCommit = await this._fetchLastCommit();
        // HEAD détachée : name est undefined quand on est sur un commit orphelin.
        const detachedHead = this._repo.state.HEAD !== undefined && this._repo.state.HEAD.name === undefined;
        const rebaseState = this._readRebaseState();
        // ahead/behind ne sont renseignés que si un upstream est configuré.
        const head = this._repo.state.HEAD;
        const ahead = head?.ahead ?? 0;
        const behind = head?.behind ?? 0;
        this._webviewView.webview.postMessage({
            type: 'update',
            stagedCount,
            lastCommit,
            detachedHead,
            rebaseState,
            ahead,
            behind,
        });
    }

    private _readRebaseState(): RebaseState | null {
        if (!this._repo) {
            return null;
        }
        const gitDir = path.join(this._repo.rootUri.fsPath, '.git');
        // rebase-merge couvre le rebase interactif et le rebase simple (git >= 2.24)
        const rebaseMerge = path.join(gitDir, 'rebase-merge');
        // rebase-apply couvre l'ancien format (git am, git rebase --apply)
        const rebaseApply = path.join(gitDir, 'rebase-apply');
        const dir = fs.existsSync(rebaseMerge) ? rebaseMerge : fs.existsSync(rebaseApply) ? rebaseApply : null;
        if (!dir) {
            return null;
        }
        try {
            const step = parseInt(fs.readFileSync(path.join(dir, 'msgnum'), 'utf8').trim(), 10);
            const total = parseInt(fs.readFileSync(path.join(dir, 'end'), 'utf8').trim(), 10);
            const headName = fs.readFileSync(path.join(dir, 'head-name'), 'utf8').trim();
            const onto = fs.readFileSync(path.join(dir, 'onto_name'), 'utf8').trim();
            const branch = headName.replace(/^refs\/heads\//, '');
            return { step: isNaN(step) ? 0 : step, total: isNaN(total) ? 0 : total, branch, onto };
        } catch {
            // Fichiers pas encore créés ou format différent — rebase détecté mais pas de détails
            return { step: 0, total: 0, branch: '', onto: '' };
        }
    }

    private async _fetchLastCommit(): Promise<LastCommit | null> {
        const hash = this._repo?.state.HEAD?.commit;
        if (!hash || !this._repo) {
            return null;
        }
        try {
            const commit = await this._repo.getCommit(hash);
            const lines = commit.message.split('\n');
            const title = lines[0].trim();
            const bodyStart = lines.findIndex((l, i) => i > 0 && l.trim() === '');
            const description =
                bodyStart !== -1
                    ? lines
                          .slice(bodyStart + 1)
                          .join('\n')
                          .trimEnd()
                    : '';
            return { hash: commit.hash.slice(0, 7), title, description };
        } catch {
            return null;
        }
    }

    /**
     * Commit exécuté via child_process (et non repo.commit()) pour capturer la sortie
     * des hooks pre-commit/commit-msg (husky, lint-staged…) dans le canal "YoGit".
     * L'API vscode.git avale cette sortie ; en cas de refus par un hook, l'utilisateur
     * ne verrait sinon aucune raison. Le commit est purement local — aucune authentification
     * réseau n'est requise, contrairement à push/pull qui restent sur l'API (askpass).
     */
    private async _doCommit(title: string, description: string, amend: boolean): Promise<void> {
        if (!this._repo || !this._gitPath) {
            return;
        }
        const message = description ? `${title}\n\n${description}` : title;
        const args = ['commit', '-m', message];
        if (amend) {
            args.push('--amend');
        }
        try {
            await runGit(this._gitPath, args, this._repo.rootUri.fsPath, { logStdout: true });
            // Commit fait hors API : forcer la relecture de l'état pour rafraîchir les vues.
            await this._repo.status();
            this._webviewView?.webview.postMessage({ type: 'committed' });
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            // Un hook a probablement refusé le commit — révéler ses logs sans voler le focus.
            getGitOutputChannel().show(true);
            this._webviewView?.webview.postMessage({ type: 'error', message: errMsg });
        }
    }

    private _buildHtml(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'out', 'webview', 'commit.js'),
        );
        const nonce = randomBytes(16).toString('hex');
        return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}';" />
</head>
<body>
    <yogit-commit></yogit-commit>
    <script nonce="${nonce}">window.__YOGIT_LOCALE__ = ${JSON.stringify(resolveWebviewLocale())};</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
