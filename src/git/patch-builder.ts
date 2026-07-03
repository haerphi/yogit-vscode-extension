import { DiffLine, DiffLineType, FileDiff, HunkSelection } from '../types/diff';

/**
 * Construit un patch git valide à partir d'une sélection partielle de hunks/lignes.
 *
 * Règles pour les lignes non sélectionnées :
 *   - Ligne "-" non sélectionnée → convertie en contexte " "
 *     (la ligne reste dans le fichier, elle n'est pas supprimée)
 *   - Ligne "+" non sélectionnée → omise complètement
 *     (la ligne n'est pas ajoutée)
 *
 * Les compteurs oldLines/newLines du header @@ sont recalculés en conséquence
 * car git apply --cached les vérifie strictement.
 */
export function buildPartialPatch(diff: FileDiff, selection: HunkSelection): string {
    const selectedIndices = Object.keys(selection)
        .map(Number)
        .filter(i => {
            const sel = selection[i];
            return sel === 'all' || (Array.isArray(sel) && sel.length > 0);
        });

    if (selectedIndices.length === 0) {
        return '';
    }

    let patch = diff.header + '\n';

    for (const hunkIndex of selectedIndices) {
        const hunk = diff.hunks[hunkIndex];
        const sel = selection[hunkIndex];

        if (sel === 'all') {
            patch += buildHunkHeader(hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines, hunk.contextHint);
            for (const line of hunk.lines) {
                patch += prefixChar(line.type) + line.content + '\n';
            }
        } else {
            const selectedSet = new Set(sel);
            const resultLines: DiffLine[] = [];

            for (const line of hunk.lines) {
                if (line.type === 'context') {
                    resultLines.push(line);
                } else if (line.type === 'remove') {
                    if (selectedSet.has(line.index)) {
                        resultLines.push(line);
                    } else {
                        // Non sélectionné : la ligne reste → contexte
                        resultLines.push({ ...line, type: 'context' });
                    }
                } else {
                    // add
                    if (selectedSet.has(line.index)) {
                        resultLines.push(line);
                    }
                    // Non sélectionné : la ligne n'est pas ajoutée → on l'omet
                }
            }

            // oldLines = lignes présentes dans le vieux fichier = contexte + suppressions
            const newOldLines = resultLines.filter(l => l.type !== 'add').length;
            // newLines = lignes présentes dans le nouveau fichier = contexte + ajouts
            const newNewLines = resultLines.filter(l => l.type !== 'remove').length;

            patch += buildHunkHeader(hunk.oldStart, newOldLines, hunk.newStart, newNewLines, hunk.contextHint);
            for (const line of resultLines) {
                patch += prefixChar(line.type) + line.content + '\n';
            }
        }
    }

    return patch;
}

function prefixChar(type: DiffLineType): string {
    if (type === 'add') {
        return '+';
    }
    if (type === 'remove') {
        return '-';
    }
    return ' ';
}

function buildHunkHeader(oldStart: number, oldLines: number, newStart: number, newLines: number, hint: string): string {
    const hintPart = hint ? ` ${hint}` : '';
    return `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@${hintPart}\n`;
}
