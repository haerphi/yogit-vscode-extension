import * as path from 'path';
import { runGit } from './git-exec';

/** Résultat de `git blame` pour une seule ligne. */
export interface BlameLine {
    hash: string;
    shortHash: string;
    /** Vrai quand la ligne n'est dans aucun commit (modification locale non commitée). */
    uncommitted: boolean;
    author: string;
    authorMail: string;
    /** Date de l'auteur, en secondes epoch. */
    authorTime: number;
    /** Première ligne du message de commit. */
    summary: string;
}

/** git remplit le hash de zéros pour les lignes absentes de l'historique. */
const ZERO_HASH = /^0+$/;
const HASH = /^[0-9a-f]{7,64}$/;

/**
 * Blame d'une seule ligne (1-based) du fichier donné.
 *
 * `contents` permet de blâmer le buffer en cours d'édition plutôt que le fichier sur
 * disque : sans lui, la moindre ligne insérée décale l'annotation de tout le reste du
 * fichier tant que l'utilisateur n'a pas sauvegardé.
 *
 * Retourne undefined si la ligne n'est pas attribuable (fichier hors dépôt, non suivi,
 * ligne au-delà de la fin du fichier) — tous ces cas font sortir git en erreur.
 */
export async function blameLine(
    gitPath: string,
    cwd: string,
    filePath: string,
    line: number,
    contents?: string,
): Promise<BlameLine | undefined> {
    const relative = toRepoRelative(cwd, filePath);
    if (!relative) {
        return undefined;
    }

    const args = ['blame', '--line-porcelain', '-L', `${line},${line}`];
    if (contents !== undefined) {
        args.push('--contents', '-');
    }
    args.push('--', relative);

    const raw = await runGit(gitPath, args, cwd, { quiet: true, input: contents });
    return parsePorcelain(raw);
}

/** Parents d'un commit, dans l'ordre — attendus par CommitDetailPanel. */
export async function getParentHashes(gitPath: string, cwd: string, hash: string): Promise<string[]> {
    const raw = await runGit(gitPath, ['show', '--no-patch', '--format=%P', hash], cwd, { quiet: true });
    return raw.trim().split(/\s+/).filter(Boolean);
}

/** Adresse e-mail configurée localement, pour distinguer « vous » des autres auteurs. */
export async function getUserEmail(gitPath: string, cwd: string): Promise<string> {
    try {
        const raw = await runGit(gitPath, ['config', '--get', 'user.email'], cwd, { quiet: true });
        return raw.trim().toLowerCase();
    } catch {
        // `git config --get` sort en 1 quand la clé n'est pas définie : ce n'est pas une erreur.
        return '';
    }
}

/**
 * Chemin du fichier relatif à la racine du dépôt, en séparateurs `/`.
 * Retourne undefined si le fichier est en dehors du dépôt.
 */
function toRepoRelative(cwd: string, filePath: string): string | undefined {
    const relative = path.relative(cwd, filePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        return undefined;
    }
    return relative.split(path.sep).join('/');
}

/**
 * Extrait les en-têtes porcelain d'une ligne blâmée.
 *
 * Format : `<hash> <ligne-source> <ligne-finale> <nb>` puis un en-tête `clé valeur`
 * par ligne, terminés par la ligne de code elle-même préfixée d'une tabulation.
 */
function parsePorcelain(raw: string): BlameLine | undefined {
    const lines = raw.split('\n');
    const hash = lines[0]?.split(' ')[0] ?? '';
    if (!HASH.test(hash)) {
        return undefined;
    }

    let author = '';
    let authorMail = '';
    let authorTime = 0;
    let summary = '';
    for (const line of lines.slice(1)) {
        if (line.startsWith('\t')) {
            break;
        }
        if (line.startsWith('author ')) {
            author = line.slice('author '.length);
        } else if (line.startsWith('author-mail ')) {
            authorMail = line.slice('author-mail '.length).replace(/^<|>$/g, '');
        } else if (line.startsWith('author-time ')) {
            authorTime = Number(line.slice('author-time '.length));
        } else if (line.startsWith('summary ')) {
            summary = line.slice('summary '.length);
        }
    }

    return {
        hash,
        shortHash: hash.slice(0, 7),
        uncommitted: ZERO_HASH.test(hash),
        author,
        authorMail: authorMail.toLowerCase(),
        authorTime,
        summary,
    };
}
