import { spawn } from 'child_process';
import * as vscode from 'vscode';

/**
 * Erreur enrichie d'un appel git.
 *
 * En plus d'un `message` toujours lisible et non vide (voir buildFailureMessage), elle
 * conserve le code de sortie et les flux bruts stdout/stderr. Les appelants peuvent donc
 * afficher `.message` directement dans showErrorMessage tout en gardant la possibilité
 * d'inspecter `exitCode`/`stderr` pour un traitement plus fin (ex: détecter des conflits).
 */
export class GitError extends Error {
    readonly args: string[];
    readonly exitCode: number | null;
    readonly stderr: string;
    readonly stdout: string;

    constructor(message: string, details: { args: string[]; exitCode: number | null; stderr: string; stdout: string }) {
        super(message);
        this.name = 'GitError';
        this.args = details.args;
        this.exitCode = details.exitCode;
        this.stderr = details.stderr;
        this.stdout = details.stdout;
    }
}

export interface RunGitOptions {
    /** Contenu écrit sur stdin puis fermé (patch, blob pour hash-object, …). */
    input?: string | Buffer;
    /** Variables d'environnement supplémentaires, fusionnées avec process.env. */
    env?: NodeJS.ProcessEnv;
}

/**
 * Construit un message d'échec **toujours non vide**.
 *
 * On privilégie stderr (là où git écrit ses erreurs), puis stdout (certaines commandes
 * y écrivent le vrai message), et en dernier recours un message explicite avec le code
 * de sortie. Sans ce dernier filet, un `new Error(stderr.trim())` sur un stderr vide
 * produisait des messages « … a échoué : » sans aucune raison affichée.
 */
function buildFailureMessage(args: string[], exitCode: number | null, stderr: string, stdout: string): string {
    const detail = stderr || stdout;
    if (detail) {
        return detail;
    }
    const sub = args[0] ?? 'git';
    return vscode.l10n.t('git {0} exited with code {1}', sub, exitCode === null ? '?' : String(exitCode));
}

/** Message lisible quand le process git ne démarre même pas (binaire introuvable, cwd invalide…). */
function buildSpawnErrorMessage(gitPath: string, err: NodeJS.ErrnoException): string {
    if (err.code === 'ENOENT') {
        return vscode.l10n.t('Git executable not found: {0}', gitPath);
    }
    return err.message;
}

function spawnGit(gitPath: string, args: string[], cwd: string, opts: RunGitOptions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const proc = spawn(gitPath, args, {
            cwd,
            env: opts.env ? { ...process.env, ...opts.env } : process.env,
        });
        const outChunks: Buffer[] = [];
        const errChunks: Buffer[] = [];

        proc.stdout.on('data', (d: Buffer) => outChunks.push(d));
        proc.stderr.on('data', (d: Buffer) => errChunks.push(d));

        // Sans ce handler, un spawn en échec (git absent, cwd invalide) laisserait la
        // Promise en suspens indéfiniment — la commande resterait bloquée, sans aucun feedback.
        proc.on('error', (err: NodeJS.ErrnoException) => {
            reject(
                new GitError(buildSpawnErrorMessage(gitPath, err), { args, exitCode: null, stderr: '', stdout: '' }),
            );
        });

        proc.on('close', code => {
            const stdout = Buffer.concat(outChunks);
            const stderr = Buffer.concat(errChunks).toString().trim();
            if (code === 0) {
                resolve(stdout);
                return;
            }
            const stdoutTrimmed = stdout.toString().trim();
            reject(
                new GitError(buildFailureMessage(args, code, stderr, stdoutTrimmed), {
                    args,
                    exitCode: code,
                    stderr,
                    stdout: stdoutTrimmed,
                }),
            );
        });

        if (opts.input !== undefined) {
            // Un EPIPE peut survenir si git ferme stdin avant qu'on ait fini d'écrire — on
            // l'ignore, le vrai résultat (code de sortie) est géré par 'close'/'error'.
            proc.stdin.on('error', () => undefined);
            proc.stdin.end(opts.input);
        }
    });
}

/**
 * Exécute git et résout avec stdout décodé en UTF-8 (non trimmé).
 * Rejette un {@link GitError} au message toujours exploitable en cas d'échec.
 */
export function runGit(gitPath: string, args: string[], cwd: string, opts: RunGitOptions = {}): Promise<string> {
    return spawnGit(gitPath, args, cwd, opts).then(buf => buf.toString());
}

/** Comme {@link runGit} mais résout avec le Buffer brut de stdout (octets exacts, binaires). */
export function runGitBuffer(gitPath: string, args: string[], cwd: string, opts: RunGitOptions = {}): Promise<Buffer> {
    return spawnGit(gitPath, args, cwd, opts);
}
