import { API } from '@haerphi/vscode-git-api-types';
import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseDiff } from '../../git/diff-parser';
import { FileDiff, Hunk, HunkSelection } from '../../types/diff';
import { ChangeLeaf } from '../../git/changes-provider';
import { DiffPanel } from '../../ui/DiffPanel';
import { getRepo } from '../utils';

// ─── Helpers git ─────────────────────────────────────────────────────────────

function gitDiff(gitPath: string, relPath: string, cwd: string, cached = false): Promise<string> {
    return new Promise((resolve, reject) => {
        const args = cached ? ['diff', '--no-color', '--cached', '--', relPath] : ['diff', '--no-color', '--', relPath];
        const proc = spawn(gitPath, args, { cwd });
        const out: string[] = [];
        const err: string[] = [];
        proc.stdout.on('data', (d: Buffer) => out.push(d.toString()));
        proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
        proc.on('close', code => (code === 0 ? resolve(out.join('')) : reject(new Error(err.join('').trim()))));
    });
}

/**
 * Lit le contenu du fichier depuis l'INDEX git (stage 0).
 *
 * `:0:<relPath>` est la syntaxe git pour "fichier dans l'index, stage normal".
 * Retourne un Buffer pour préserver les octets exacts (binaires, encodages).
 */
function gitCatFile(gitPath: string, relPath: string, cwd: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const proc = spawn(gitPath, ['cat-file', 'blob', `:0:${relPath}`], { cwd });
        const chunks: Buffer[] = [];
        const err: string[] = [];
        proc.stdout.on('data', (d: Buffer) => chunks.push(d));
        proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
        proc.on('close', code =>
            code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(err.join('').trim())),
        );
    });
}

/**
 * Écrit un Buffer dans le store git et retourne son hash SHA-1.
 * Équivalent de `echo content | git hash-object -w --stdin`.
 */
function gitHashObjectWrite(gitPath: string, content: Buffer, cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const proc = spawn(gitPath, ['hash-object', '-w', '--stdin'], { cwd });
        const out: string[] = [];
        const err: string[] = [];
        proc.stdout.on('data', (d: Buffer) => out.push(d.toString()));
        proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
        proc.on('close', code => (code === 0 ? resolve(out.join('').trim()) : reject(new Error(err.join('').trim()))));
        proc.stdin.end(content);
    });
}

/**
 * Récupère le mode et le hash courant du fichier dans l'index
 * via `git ls-files -s`. Format de sortie : "<mode> <hash> <stage>\t<path>".
 */
function gitLsFiles(gitPath: string, relPath: string, cwd: string): Promise<{ mode: string }> {
    return new Promise((resolve, reject) => {
        const proc = spawn(gitPath, ['ls-files', '-s', '--', relPath], { cwd });
        const out: string[] = [];
        proc.stdout.on('data', (d: Buffer) => out.push(d.toString()));
        proc.on('close', code => {
            if (code !== 0) {
                reject(new Error('ls-files failed'));
                return;
            }
            const line = out.join('').trim();
            const mode = line.split(' ')[0] ?? '100644';
            resolve({ mode });
        });
    });
}

/**
 * Met à jour l'entrée de l'index pour un fichier via `git update-index --cacheinfo`.
 * C'est la commande plomberie qui écrit directement dans l'index sans passer par
 * git apply, contournant ainsi les problèmes de correspondance de contexte sur WSL UNC.
 */
function gitUpdateIndex(gitPath: string, mode: string, hash: string, relPath: string, cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = spawn(gitPath, ['update-index', '--cacheinfo', `${mode},${hash},${relPath}`], { cwd });
        const err: string[] = [];
        proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
        proc.on('close', code => (code === 0 ? resolve() : reject(new Error(err.join('').trim()))));
    });
}

// ─── Application en mémoire ───────────────────────────────────────────────────

/**
 * Applique les hunks sélectionnés au contenu de l'index et retourne le nouveau contenu.
 *
 * La logique de chaque ligne :
 *   - context  → copiée telle quelle (headIdx avance)
 *   - remove sélectionné   → supprimée (headIdx avance, pas d'ajout au résultat)
 *   - remove non sélectionné → conservée comme contexte
 *   - add sélectionné      → insérée (headIdx n'avance pas)
 *   - add non sélectionné  → ignorée
 */
/**
 * Applique ou retire des hunks en mémoire selon le mode.
 *
 * Mode 'stage'   : lit l'index (HEAD == INDEX quand rien n'est stagé), applique les
 *                  changements du working tree sélectionnés.
 *                  - remove sélectionné → supprimé de l'index
 *                  - add sélectionné    → inséré dans l'index
 *
 * Mode 'unstage' : lit l'index (contient les changements stagés), applique l'inverse.
 *                  Le diff est `git diff --cached` (INDEX vs HEAD) :
 *                  - '+' dans ce diff = ajouté à l'index ; sélectionné → supprimer
 *                  - '-' dans ce diff = supprimé de l'index ; sélectionné → réinsérer
 *                  C'est le même algorithme avec les rôles add/remove inversés.
 */
function applyHunksInMemory(
    indexContent: Buffer,
    fileDiff: FileDiff,
    selection: HunkSelection,
    mode: 'stage' | 'unstage' = 'stage',
): Buffer {
    const text = indexContent.toString('utf8');
    const endsWithNewline = text.endsWith('\n');
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    if (endsWithNewline && lines[lines.length - 1] === '') {
        lines.pop();
    }

    const result: string[] = [];
    let headIdx = 0;

    const orderedHunks = fileDiff.hunks
        .filter(h => selection[h.index] !== undefined)
        .sort((a, b) => a.oldStart - b.oldStart);

    for (const hunk of orderedHunks) {
        const sel = selection[hunk.index];
        if (!sel) {
            continue;
        }
        const selectedSet: Set<number> | null = sel === 'all' ? null : new Set(sel);

        // En mode unstage le diff est HEAD→INDEX : newStart correspond à la position
        // dans l'INDEX (notre source). En mode stage c'est oldStart (position HEAD = INDEX).
        const hunkStart = (mode === 'unstage' ? hunk.newStart : hunk.oldStart) - 1;
        while (headIdx < hunkStart) {
            result.push(lines[headIdx++]);
        }

        processHunkLines(hunk, selectedSet, lines, headIdx, result, mode);
        headIdx = advanceHeadIdx(hunk, headIdx, mode);
    }

    while (headIdx < lines.length) {
        result.push(lines[headIdx++]);
    }

    return Buffer.from(result.join('\n') + (endsWithNewline ? '\n' : ''), 'utf8');
}

function processHunkLines(
    hunk: Hunk,
    selectedSet: Set<number> | null,
    lines: string[],
    startIdx: number,
    result: string[],
    mode: 'stage' | 'unstage',
): void {
    let headIdx = startIdx;
    for (const line of hunk.lines) {
        if (line.type === 'context') {
            result.push(lines[headIdx++]);
        } else if (line.type === 'remove') {
            if (mode === 'stage') {
                // remove dans le diff WC→INDEX = ligne à supprimer de l'index
                if (selectedSet === null || selectedSet.has(line.index)) {
                    headIdx++; // supprimée
                } else {
                    result.push(lines[headIdx++]); // conservée
                }
            } else {
                // remove dans le diff HEAD→INDEX = ligne absente de l'index ; si
                // sélectionnée pour unstage, la réinsérer (headIdx n'avance pas)
                if (selectedSet === null || selectedSet.has(line.index)) {
                    result.push(line.content); // réinsérée
                }
            }
        } else {
            // add
            if (mode === 'stage') {
                if (selectedSet === null || selectedSet.has(line.index)) {
                    result.push(line.content);
                }
            } else {
                // add dans le diff HEAD→INDEX = ligne présente dans l'index ; si
                // sélectionnée pour unstage, la supprimer (headIdx avance sans push)
                if (selectedSet === null || selectedSet.has(line.index)) {
                    headIdx++; // supprimée de l'index
                } else {
                    result.push(lines[headIdx++]); // conservée
                }
            }
        }
    }
}

function advanceHeadIdx(hunk: Hunk, startIdx: number, mode: 'stage' | 'unstage'): number {
    let idx = startIdx;
    for (const line of hunk.lines) {
        // En stage : les lignes qui existent dans l'index source sont context + remove
        // En unstage : les lignes qui existent dans l'index source sont context + add
        const existsInSource = mode === 'stage' ? line.type !== 'add' : line.type !== 'remove';
        if (existsInSource) {
            idx++;
        }
    }
    return idx;
}

// ─── Commande principale ──────────────────────────────────────────────────────

/**
 * Enregistre la commande haerphi-yogit.stage-hunks.
 *
 * Déclenchée sur un fichier non stagé (contextValue: change-unstaged).
 * Flux :
 *   1. `git diff` → parsing du diff
 *   2. DiffPanel → sélection interactive des hunks/lignes
 *   3. Lecture du contenu de l'INDEX via git cat-file
 *   4. Application des hunks en mémoire
 *   5. Écriture dans l'object store + mise à jour de l'index via git plumbing
 *   6. `repo.status()` pour rafraîchir la TreeView
 */
export function registerStageHunk(gitApi: API, context: vscode.ExtensionContext): vscode.Disposable[] {
    const stageHunks = vscode.commands.registerCommand('haerphi-yogit.stage-hunks', (node: ChangeLeaf) =>
        runHunkCommand(gitApi, context, node, false),
    );
    const unstageHunks = vscode.commands.registerCommand('haerphi-yogit.unstage-hunks', (node: ChangeLeaf) =>
        runHunkCommand(gitApi, context, node, true),
    );
    return [stageHunks, unstageHunks];
}

async function runHunkCommand(
    gitApi: API,
    context: vscode.ExtensionContext,
    node: ChangeLeaf,
    unstage: boolean,
): Promise<void> {
    const repo = getRepo(gitApi);
    if (!repo) {
        return;
    }

    const fsPath = node.change.uri.fsPath;
    const cwd = repo.rootUri.fsPath;
    const relPath = path.relative(cwd, fsPath).replace(/\\/g, '/');

    let rawDiff: string;
    try {
        rawDiff = await gitDiff(gitApi.git.path, relPath, cwd, unstage);
    } catch (err) {
        vscode.window.showErrorMessage(
            vscode.l10n.t('Could not get the diff: {0}', err instanceof Error ? err.message : String(err)),
        );
        return;
    }

    const fileDiff = parseDiff(rawDiff, relPath);
    if (!fileDiff) {
        vscode.window.showInformationMessage(vscode.l10n.t('No textual change detected (binary file?).'));
        return;
    }
    fileDiff.actionLabel = unstage ? vscode.l10n.t('Unstage') : vscode.l10n.t('Stage');

    const selection = await DiffPanel.show(context, fileDiff);
    if (!selection || Object.keys(selection).length === 0) {
        return;
    }

    try {
        const indexContent = await gitCatFile(gitApi.git.path, relPath, cwd);
        const newContent = applyHunksInMemory(indexContent, fileDiff, selection, unstage ? 'unstage' : 'stage');
        const hash = await gitHashObjectWrite(gitApi.git.path, newContent, cwd);
        const { mode } = await gitLsFiles(gitApi.git.path, relPath, cwd);
        await gitUpdateIndex(gitApi.git.path, mode, hash, relPath, cwd);
        await repo.status();
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(
            unstage
                ? vscode.l10n.t('Could not unstage the selection: {0}', errMsg)
                : vscode.l10n.t('Could not stage the selection: {0}', errMsg),
        );
    }
}
