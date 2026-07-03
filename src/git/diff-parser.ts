import { DiffLine, DiffLineType, FileDiff, Hunk } from '../types/diff';

// @@ -oldStart[,oldLines] +newStart[,newLines] @@ [contextHint]
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/;

/**
 * Parse la sortie brute de `git diff <file>` en une structure FileDiff.
 *
 * Lignes traitées :
 *   - "diff --git …", "index …", "--- …", "+++ …" → header
 *   - "@@ … @@" → début d'un hunk
 *   - " "/"+"/ "-" → lignes contexte/ajout/suppression
 *   - "\ No newline at end of file" → ignoré (pas de sémantique pour le patch builder)
 *
 * Si le diff est vide (fichier binaire ou pas de changements), renvoie null.
 */
export function parseDiff(raw: string, filePath: string): FileDiff | null {
    // split sur \r?\n pour gérer les CRLF que Windows git peut produire
    const lines = raw.split(/\r?\n/);
    const headerLines: string[] = [];
    const hunks: Hunk[] = [];
    let currentHunk: Hunk | null = null;
    let lineIndex = 0;
    let inHeader = true;

    for (const rawLine of lines) {
        const hunkMatch = rawLine.match(HUNK_HEADER_RE);

        if (hunkMatch) {
            inHeader = false;
            lineIndex = 0;
            currentHunk = {
                index: hunks.length,
                oldStart: parseInt(hunkMatch[1], 10),
                oldLines: hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1,
                newStart: parseInt(hunkMatch[3], 10),
                newLines: hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1,
                contextHint: hunkMatch[5].trim(),
                lines: [],
            };
            hunks.push(currentHunk);
            continue;
        }

        if (inHeader) {
            headerLines.push(rawLine);
            continue;
        }

        if (!currentHunk) {
            continue;
        }

        // Ignorer la marque "pas de retour à la ligne" et les lignes vides
        // produites par le \n final de la sortie git diff
        if (rawLine === '' || rawLine.startsWith('\\')) {
            continue;
        }

        const prefix = rawLine[0];
        let type: DiffLineType;
        if (prefix === '+') {
            type = 'add';
        } else if (prefix === '-') {
            type = 'remove';
        } else {
            type = 'context';
        }

        const diffLine: DiffLine = {
            type,
            content: rawLine.slice(1), // retirer le préfixe +/-/
            index: lineIndex++,
        };
        currentHunk.lines.push(diffLine);
    }

    if (hunks.length === 0) {
        return null;
    }

    return {
        filePath,
        header: headerLines.join('\n'),
        hunks,
    };
}
