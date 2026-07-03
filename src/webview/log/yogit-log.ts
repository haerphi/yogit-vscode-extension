import { LitElement, PropertyValues, css, html, svg } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { CommitEntry, LogRef } from '../../types/log';

declare global {
    interface Window {
        acquireVsCodeApi: () => { postMessage: (msg: unknown) => void };
    }
}

const vscode = window.acquireVsCodeApi();

// ── Graph layout constants ────────────────────────────────────────────────────
const LANE_W = 12;
const ROW_H = 24;
const DOT_R = 3.5;
const GRAPH_COLORS = ['#4e9de0', '#4ec94e', '#e09a4e', '#9e4ee0', '#e04ea0', '#4ec9c9', '#d4e04e', '#e04e4e'];

/** Retourne '#fff' ou '#111' selon la luminance perçue de la couleur de fond hex. */
function _contrastColor(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // Luminance relative perçue (formule W3C)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.55 ? '#111' : '#fff';
}

// ── Graph computation ─────────────────────────────────────────────────────────
interface UpperEdge {
    col: number;
    colorIdx: number;
}
interface LowerEdge {
    from: number;
    to: number;
    colorIdx: number;
}
interface GraphRow {
    commit: CommitEntry;
    col: number;
    colorIdx: number;
    upperEdges: UpperEdge[];
    lowerEdges: LowerEdge[];
    numLanes: number;
}

function computeGraph(commits: CommitEntry[]): GraphRow[] {
    const rows: GraphRow[] = [];
    let activeLanes: (string | null)[] = [];
    const colorMap = new Map<string, number>();
    let nextColor = 0;

    for (const commit of commits) {
        let col = activeLanes.indexOf(commit.hash);
        if (col === -1) {
            const empty = activeLanes.indexOf(null);
            col = empty !== -1 ? empty : activeLanes.length;
            if (empty !== -1) {
                activeLanes[col] = commit.hash;
            } else {
                activeLanes.push(commit.hash);
            }
        }

        if (!colorMap.has(commit.hash)) {
            colorMap.set(commit.hash, nextColor++ % GRAPH_COLORS.length);
        }
        const colorIdx = colorMap.get(commit.hash)!;

        const upperEdges: UpperEdge[] = [];
        for (let l = 0; l < activeLanes.length; l++) {
            if (activeLanes[l] !== null) {
                upperEdges.push({ col: l, colorIdx: colorMap.get(activeLanes[l]!)! });
            }
        }

        activeLanes[col] = null;
        const lowerEdges: LowerEdge[] = [];

        if (commit.parentHashes.length > 0) {
            const p0 = commit.parentHashes[0];
            const p0Existing = activeLanes.indexOf(p0);
            if (p0Existing !== -1) {
                lowerEdges.push({ from: col, to: p0Existing, colorIdx });
            } else {
                activeLanes[col] = p0;
                colorMap.set(p0, colorIdx);
                lowerEdges.push({ from: col, to: col, colorIdx });
            }

            for (let p = 1; p < commit.parentHashes.length; p++) {
                const pHash = commit.parentHashes[p];
                const pExisting = activeLanes.indexOf(pHash);
                let pCol: number;
                if (pExisting !== -1) {
                    pCol = pExisting;
                } else {
                    const empty = activeLanes.indexOf(null);
                    pCol = empty !== -1 ? empty : activeLanes.length;
                    if (empty !== -1) {
                        activeLanes[pCol] = pHash;
                    } else {
                        activeLanes.push(pHash);
                    }
                    if (!colorMap.has(pHash)) {
                        colorMap.set(pHash, nextColor++ % GRAPH_COLORS.length);
                    }
                }
                lowerEdges.push({ from: col, to: pCol, colorIdx: colorMap.get(pHash)! });
            }
        }

        for (let l = 0; l < activeLanes.length; l++) {
            if (l !== col && activeLanes[l] !== null) {
                lowerEdges.push({ from: l, to: l, colorIdx: colorMap.get(activeLanes[l]!)! });
            }
        }

        while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] === null) {
            activeLanes.pop();
        }

        const allCols = [col, ...upperEdges.map(e => e.col), ...lowerEdges.map(e => Math.max(e.from, e.to))];
        rows.push({ commit, col, colorIdx, upperEdges, lowerEdges, numLanes: Math.max(...allCols) + 1 });
    }

    return rows;
}

// ── Diff parsing ──────────────────────────────────────────────────────────────
type DiffLineKind = 'hunk' | 'added' | 'removed' | 'context' | 'meta';

interface DiffLine {
    kind: DiffLineKind;
    content: string;
}

interface FileDiff {
    path: string;
    added: number;
    removed: number;
    lines: DiffLine[];
}

interface DiffData {
    hash: string;
    author: string;
    date: string;
    body: string;
    files: FileDiff[];
}

function parseDiff(raw: string): FileDiff[] {
    const files: FileDiff[] = [];
    let cur: FileDiff | null = null;

    for (const line of raw.split('\n')) {
        if (line.startsWith('diff --git ')) {
            if (cur) {
                files.push(cur);
            }
            const m = line.match(/diff --git a\/(.*) b\/(.*)/);
            cur = { path: m?.[2] ?? line, added: 0, removed: 0, lines: [] };
        } else if (cur) {
            if (line.startsWith('@@')) {
                cur.lines.push({ kind: 'hunk', content: line });
            } else if (line.startsWith('+') && !line.startsWith('+++')) {
                cur.lines.push({ kind: 'added', content: line.slice(1) });
                cur.added++;
            } else if (line.startsWith('-') && !line.startsWith('---')) {
                cur.lines.push({ kind: 'removed', content: line.slice(1) });
                cur.removed++;
            } else if (line.startsWith(' ')) {
                cur.lines.push({ kind: 'context', content: line.slice(1) });
            } else if (
                line.startsWith('new file') ||
                line.startsWith('deleted file') ||
                line.startsWith('rename') ||
                line.startsWith('Binary')
            ) {
                cur.lines.push({ kind: 'meta', content: line });
            }
        }
    }
    if (cur) {
        files.push(cur);
    }
    return files;
}

// ── File tree ─────────────────────────────────────────────────────────────────
interface TreeNode {
    name: string;
    fullPath: string;
    isDir: boolean;
    children: TreeNode[];
    fileIndex: number;
    added: number;
    removed: number;
}

function buildTree(files: FileDiff[]): TreeNode[] {
    interface MNode {
        name: string;
        fullPath: string;
        isDir: boolean;
        children: Map<string, MNode>;
        fileIndex: number;
        added: number;
        removed: number;
    }

    const root = new Map<string, MNode>();

    files.forEach((file, idx) => {
        const parts = file.path.split('/');
        let current = root;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!current.has(part)) {
                current.set(part, {
                    name: part,
                    fullPath: parts.slice(0, i + 1).join('/'),
                    isDir: true,
                    children: new Map(),
                    fileIndex: -1,
                    added: 0,
                    removed: 0,
                });
            }
            current = current.get(part)!.children;
        }

        const fileName = parts[parts.length - 1];
        current.set(fileName, {
            name: fileName,
            fullPath: file.path,
            isDir: false,
            children: new Map(),
            fileIndex: idx,
            added: file.added,
            removed: file.removed,
        });
    });

    function aggregate(node: MNode): void {
        if (!node.isDir) {
            return;
        }
        node.added = 0;
        node.removed = 0;
        for (const child of node.children.values()) {
            aggregate(child);
            node.added += child.added;
            node.removed += child.removed;
        }
    }

    function toArray(m: Map<string, MNode>): TreeNode[] {
        return Array.from(m.values())
            .map(n => ({
                name: n.name,
                fullPath: n.fullPath,
                isDir: n.isDir,
                children: toArray(n.children),
                fileIndex: n.fileIndex,
                added: n.added,
                removed: n.removed,
            }))
            .sort((a, b) => {
                if (a.isDir !== b.isDir) {
                    return a.isDir ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });
    }

    const syntheticRoot: MNode = {
        name: '',
        fullPath: '',
        isDir: true,
        children: root,
        fileIndex: -1,
        added: 0,
        removed: 0,
    };
    aggregate(syntheticRoot);

    return toArray(root);
}

function fileId(path: string): string {
    return 'fd-' + path.replace(/[^a-zA-Z0-9]/g, '_');
}

// ── Lit component ─────────────────────────────────────────────────────────────
type ProviderMessage =
    | { type: 'commits'; commits: CommitEntry[] }
    | { type: 'error'; message: string }
    | { type: 'diff'; hash: string; author: string; date: string; body: string; rawDiff: string }
    | { type: 'diff-error'; message: string }
    | { type: 'cherry-pick-error'; message: string };

interface CtxMenu {
    hash: string;
    shortHash: string;
    /** Tags pointant sur ce commit — un item de suppression par tag. */
    tags: string[];
    x: number;
    y: number;
}

export class YogitLog extends LitElement {
    static properties = {
        commits: { type: Array },
        selectedHash: { type: String },
        loading: { type: Boolean },
        error: { type: String },
        _diffLoading: { state: true },
        _diffError: { state: true },
        _diffData: { state: true },
        _collapsedFiles: { state: true },
        _collapsedDirs: { state: true },
        _selectedFile: { state: true },
        _filterText: { state: true },
        _ctxMenu: { state: true },
    };

    declare commits: CommitEntry[];
    declare selectedHash: string;
    declare loading: boolean;
    declare error: string;
    declare _diffLoading: boolean;
    declare _diffError: string;
    declare _diffData: DiffData | null;
    declare _collapsedFiles: Set<string>;
    declare _collapsedDirs: Set<string>;
    declare _selectedFile: string;
    declare _filterText: string;
    declare _ctxMenu: CtxMenu | null;

    private _graphRows: GraphRow[] = [];
    private _graphWidth = LANE_W;
    private _treeNodes: TreeNode[] = [];

    constructor() {
        super();
        this.commits = [];
        this.selectedHash = '';
        this.loading = true;
        this.error = '';
        this._diffLoading = false;
        this._diffError = '';
        this._diffData = null;
        this._collapsedFiles = new Set();
        this._collapsedDirs = new Set();
        this._selectedFile = '';
        this._filterText = '';
        this._ctxMenu = null;
    }

    willUpdate(changed: PropertyValues<this>) {
        if (changed.has('commits' as keyof this) && this.commits.length > 0) {
            this._graphRows = computeGraph(this.commits);
            this._graphWidth = Math.max(...this._graphRows.map(r => r.numLanes)) * LANE_W;
        }
    }

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener('message', (event: MessageEvent<ProviderMessage>) => {
            const msg = event.data;
            if (msg.type === 'commits') {
                this.commits = msg.commits;
                this.loading = false;
            } else if (msg.type === 'error') {
                this.error = msg.message;
                this.loading = false;
            } else if (msg.type === 'diff') {
                if (msg.hash === this.selectedHash) {
                    const files = parseDiff(msg.rawDiff);
                    this._diffData = { hash: msg.hash, author: msg.author, date: msg.date, body: msg.body, files };
                    this._treeNodes = buildTree(files);
                    this._diffLoading = false;
                    this._diffError = '';
                    this._collapsedFiles = new Set();
                    this._collapsedDirs = new Set();
                    this._selectedFile = '';
                }
            } else if (msg.type === 'diff-error') {
                this._diffError = msg.message;
                this._diffLoading = false;
            } else if (msg.type === 'cherry-pick-error') {
                this._ctxMenu = null;
            }
        });
        document.addEventListener('click', () => {
            if (this._ctxMenu) {
                this._ctxMenu = null;
            }
        });
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this._ctxMenu) {
                this._ctxMenu = null;
            }
        });
        vscode.postMessage({ type: 'ready' });
    }

    private _selectCommit(hash: string) {
        // Re-cliquer sur le commit sélectionné le désélectionne — la liste reprend toute la largeur
        if (hash === this.selectedHash) {
            this.selectedHash = '';
            this._diffData = null;
            this._diffError = '';
            return;
        }
        this.selectedHash = hash;
        this._diffLoading = true;
        this._diffData = null;
        this._diffError = '';
        const row = this._graphRows.find(r => r.commit.hash === hash);
        vscode.postMessage({ type: 'load-diff', hash, parentHashes: row?.commit.parentHashes ?? [] });
    }

    private _toggleFile(path: string) {
        const s = new Set(this._collapsedFiles);
        if (s.has(path)) {
            s.delete(path);
        } else {
            s.add(path);
        }
        this._collapsedFiles = s;
    }

    private _toggleDir(path: string) {
        const s = new Set(this._collapsedDirs);
        if (s.has(path)) {
            s.delete(path);
        } else {
            s.add(path);
        }
        this._collapsedDirs = s;
    }

    private _scrollToFile(path: string) {
        // Toggle: click same file again → show all files
        this._selectedFile = this._selectedFile === path ? '' : path;
    }

    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            height: 100vh;
            position: relative;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            overflow: hidden;
        }

        .toolbar {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 6px 12px;
            background: var(--vscode-titleBar-activeBackground, var(--vscode-sideBar-background));
            border-bottom: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .toolbar-count {
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        /* ── Filter bar ── */
        .filter-bar {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
            background: var(--vscode-sideBar-background);
        }

        .filter-input {
            flex: 1;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border, transparent);
            color: var(--vscode-input-foreground);
            padding: 3px 6px;
            font-size: 11px;
            font-family: var(--vscode-font-family);
            border-radius: 3px;
            outline: none;
        }

        .filter-input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }

        .filter-input:focus {
            border-color: var(--vscode-focusBorder);
        }

        .filter-clear {
            cursor: pointer;
            color: var(--vscode-descriptionForeground);
            display: flex;
            align-items: center;
            padding: 2px 4px;
            border-radius: 2px;
            font-size: 13px;
            line-height: 1;
            user-select: none;
        }

        .filter-clear:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .filter-count {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
        }

        /* ── Filtered commit rows (no graph) ── */
        .commit-row-flat {
            display: flex;
            align-items: center;
            padding: 0 8px;
            height: ${ROW_H}px;
            cursor: pointer;
            gap: 6px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .commit-row-flat:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .commit-row-flat.selected {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        .flat-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            flex-shrink: 0;
            background: var(--vscode-descriptionForeground);
        }

        .flat-dot.selected {
            background: var(--vscode-list-activeSelectionForeground);
        }

        /* ── Context menu ── */
        .ctx-menu {
            display: none;
            position: absolute;
            z-index: 1000;
            background: var(--vscode-menu-background);
            border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
            border-radius: 4px;
            padding: 4px 0;
            min-width: 180px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
            font-size: 12px;
        }

        .ctx-menu-header {
            padding: 4px 12px 4px;
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            border-bottom: 1px solid var(--vscode-panel-border);
            margin-bottom: 4px;
            font-family: var(--vscode-editor-font-family, monospace);
        }

        .ctx-menu-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 5px 12px;
            cursor: pointer;
            color: var(--vscode-menu-foreground);
            user-select: none;
        }

        .ctx-menu-item:hover {
            background: var(--vscode-menu-selectionBackground);
            color: var(--vscode-menu-selectionForeground);
        }

        .ctx-menu-item--danger {
            color: var(--vscode-errorForeground, #e04e4e);
        }

        .ctx-menu-item--danger:hover {
            background: rgba(224, 78, 78, 0.2);
            color: var(--vscode-errorForeground, #e04e4e);
        }

        .ctx-menu-separator {
            height: 1px;
            background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border));
            margin: 3px 0;
        }

        /* ── Split layout ── */
        .log-container {
            display: flex;
            flex: 1;
            overflow: hidden;
        }

        .commits-pane {
            width: 38%;
            min-width: 220px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            border-right: 1px solid var(--vscode-panel-border);
        }

        /* Sans sélection : la liste occupe toute la largeur, le détail est masqué */
        .log-container.no-selection .commits-pane {
            width: 100%;
            border-right: none;
        }

        .log-container.no-selection .detail-pane {
            display: none;
        }

        .commit-list {
            flex: 1;
            overflow-y: auto;
        }

        .detail-pane {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .detail-body {
            flex: 1;
            display: flex;
            overflow: hidden;
        }

        /* ── Commit list ── */
        .header-row,
        .commit-row {
            display: flex;
            align-items: center;
        }

        .header-row {
            padding: 3px 8px 3px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            user-select: none;
            position: sticky;
            top: 0;
            background: var(--vscode-editor-background);
            z-index: 1;
            flex-shrink: 0;
        }

        .commit-row {
            cursor: pointer;
            height: 24px;
            padding-right: 8px;
            flex-shrink: 0;
        }

        .commit-row:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .commit-row.selected {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        .commit-row.selected .hash {
            color: var(--vscode-list-activeSelectionForeground);
        }

        .graph-spacer {
            flex-shrink: 0;
        }

        .commit-message {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 4px;
            overflow: hidden;
            min-width: 0;
            padding: 0 6px;
        }

        .message-text {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .badge {
            display: inline-block;
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 600;
            white-space: nowrap;
            flex-shrink: 0;
            line-height: 14px;
        }

        .badge-tag {
            background: #7a5c00;
            color: #fff;
        }

        .commit-author {
            width: 110px;
            flex-shrink: 0;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            padding: 0 6px;
        }

        .commit-date {
            width: 80px;
            flex-shrink: 0;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
            padding: 0 6px;
        }

        .commit-row.selected .commit-author,
        .commit-row.selected .commit-date,
        .commit-row-flat.selected .commit-author,
        .commit-row-flat.selected .commit-date {
            color: var(--vscode-list-activeSelectionForeground);
            opacity: 0.8;
        }

        .hash {
            width: 54px;
            flex-shrink: 0;
            font-size: 11px;
            font-family: var(--vscode-editor-font-family, monospace);
            color: var(--vscode-descriptionForeground);
            text-align: right;
            white-space: nowrap;
            padding-left: 6px;
        }

        /* ── Detail states ── */
        .detail-empty,
        .detail-loading {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            font-size: 12px;
        }

        .detail-error {
            padding: 16px;
            color: var(--vscode-errorForeground);
        }

        /* ── Detail header ── */
        .detail-header {
            padding: 8px 14px;
            border-bottom: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
        }

        .detail-meta {
            display: flex;
            align-items: baseline;
            gap: 8px;
            margin-bottom: 4px;
        }

        .detail-hash {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .detail-author {
            font-weight: 600;
            font-size: 12px;
        }

        .detail-date {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .detail-subject {
            font-size: 13px;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .detail-msgbody {
            margin-top: 3px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            white-space: pre-wrap;
            word-break: break-word;
        }

        /* ── File tree pane ── */
        .file-tree-pane {
            width: 200px;
            min-width: 140px;
            overflow-y: auto;
            border-right: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
            font-size: 12px;
            padding: 4px 0;
        }

        .tree-node {
            display: flex;
            align-items: center;
            gap: 4px;
            height: 22px;
            padding-right: 8px;
            cursor: pointer;
            user-select: none;
            white-space: nowrap;
            overflow: hidden;
        }

        .tree-node:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .tree-node.selected-file {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        .tree-node.selected-file .tree-stat {
            color: var(--vscode-list-activeSelectionForeground);
        }

        .tree-chevron {
            display: flex;
            align-items: center;
            flex-shrink: 0;
            color: var(--vscode-descriptionForeground);
            transition: transform 0.12s;
        }

        .tree-chevron.open {
            transform: rotate(90deg);
        }

        .tree-icon {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            opacity: 0.75;
        }

        .tree-name {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .tree-stat {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            flex-shrink: 0;
        }

        .stat-add {
            color: #4ec94e;
        }
        .stat-del {
            color: #e04e4e;
        }

        /* ── Diff viewer ── */
        .diff-viewer {
            flex: 1;
            overflow-y: auto;
            font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
            font-size: var(--vscode-editor-font-size, 12px);
        }

        .diff-file-header {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 3px 10px;
            background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background));
            border-top: 1px solid var(--vscode-panel-border);
            border-bottom: 1px solid var(--vscode-panel-border);
            cursor: pointer;
            user-select: none;
            position: sticky;
            top: 0;
            z-index: 1;
        }

        .diff-file-header:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .diff-chevron {
            display: flex;
            align-items: center;
            flex-shrink: 0;
            color: var(--vscode-descriptionForeground);
            transition: transform 0.12s;
        }

        .diff-chevron.open {
            transform: rotate(90deg);
        }

        .diff-file-path {
            flex: 1;
            font-size: 11px;
            font-weight: 600;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .diff-file-stat {
            font-size: 10px;
            flex-shrink: 0;
        }

        .diff-line {
            display: block;
            padding: 0 10px;
            white-space: pre;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 18px;
        }

        .diff-hunk {
            background: rgba(78, 157, 224, 0.1);
            color: var(--vscode-textPreformat-foreground, #4e9de0);
            padding: 1px 10px;
            font-size: 11px;
        }

        .diff-added {
            background: rgba(78, 201, 78, 0.12);
            color: var(--vscode-gitDecoration-addedResourceForeground, #4ec94e);
        }

        .diff-removed {
            background: rgba(224, 78, 78, 0.12);
            color: var(--vscode-errorForeground, #e04e4e);
        }

        .diff-meta {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 2px 10px;
        }

        /* ── Global states ── */
        .state-msg {
            padding: 24px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        .state-error {
            color: var(--vscode-errorForeground);
        }
    `;

    // ── Render: graph row ─────────────────────────────────────────────────────

    private renderRef(ref: LogRef, laneColor?: string) {
        if (ref.type === 'tag') {
            return html`<span class="badge badge-tag">${ref.name}</span>`;
        }
        // Les branches (locale, distante, HEAD) prennent la couleur de la lane du commit
        const bg = laneColor ?? '#0078d4';
        const fg = _contrastColor(bg);
        return html`<span class="badge" style=${styleMap({ background: bg, color: fg })}
            >${ref.isCurrent ? '✓ ' : ''}${ref.name}</span
        >`;
    }

    private renderRowSvg(row: GraphRow) {
        const w = this._graphWidth;
        const h = ROW_H;
        const cx = row.col * LANE_W + LANE_W / 2;
        const cy = h / 2;
        const dotColor = GRAPH_COLORS[row.colorIdx];

        const upperLines = row.upperEdges.map(e => {
            const x = e.col * LANE_W + LANE_W / 2;
            return svg`<line x1="${x}" y1="0" x2="${x}" y2="${h / 2}"
                stroke="${GRAPH_COLORS[e.colorIdx]}" stroke-width="1.5" stroke-linecap="round"/>`;
        });

        const lowerLines = row.lowerEdges.map(e => {
            const x1 = e.from * LANE_W + LANE_W / 2;
            const x2 = e.to * LANE_W + LANE_W / 2;
            const y1 = h / 2;
            const y2 = h;
            const c = GRAPH_COLORS[e.colorIdx];
            if (x1 === x2) {
                return svg`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
                    stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>`;
            }
            const cp = (y2 - y1) * 0.6;
            const d = `M${x1},${y1} C${x1},${y1 + cp} ${x2},${y2 - cp} ${x2},${y2}`;
            return svg`<path d="${d}" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>`;
        });

        return html`
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="${w}"
                height="${h}"
                style="flex-shrink:0;display:block;overflow:visible"
            >
                ${upperLines} ${lowerLines} ${svg`<circle cx="${cx}" cy="${cy}" r="${DOT_R}"
                    fill="${dotColor}" stroke="var(--vscode-editor-background)" stroke-width="1.5"/>`}
            </svg>
        `;
    }

    private _openCtxMenu(e: MouseEvent, commit: CommitEntry) {
        e.preventDefault();
        e.stopPropagation();
        const row = e.currentTarget as HTMLElement;
        const rowRect = row.getBoundingClientRect();
        const hostRect = this.getBoundingClientRect();
        this._ctxMenu = {
            hash: commit.hash,
            shortHash: commit.shortHash,
            tags: commit.refs.filter(r => r.type === 'tag').map(r => r.name),
            x: rowRect.left - hostRect.left,
            y: rowRect.bottom - hostRect.top,
        };
    }

    private _cherryPick(e: MouseEvent) {
        e.stopPropagation();
        if (!this._ctxMenu) {
            return;
        }
        vscode.postMessage({ type: 'cherry-pick', hash: this._ctxMenu.hash });
        this._ctxMenu = null;
    }

    private _revert(e: MouseEvent) {
        e.stopPropagation();
        if (!this._ctxMenu) {
            return;
        }
        vscode.postMessage({ type: 'revert', hash: this._ctxMenu.hash });
        this._ctxMenu = null;
    }

    private _rebaseInteractive(e: MouseEvent) {
        e.stopPropagation();
        if (!this._ctxMenu) {
            return;
        }
        vscode.postMessage({
            type: 'rebase-interactive',
            hash: this._ctxMenu.hash,
            shortHash: this._ctxMenu.shortHash,
        });
        this._ctxMenu = null;
    }

    private _switchToCommit(e: MouseEvent) {
        e.stopPropagation();
        if (!this._ctxMenu) {
            return;
        }
        vscode.postMessage({ type: 'switch-to-commit', hash: this._ctxMenu.hash, shortHash: this._ctxMenu.shortHash });
        this._ctxMenu = null;
    }

    private _resetToCommit(e: MouseEvent) {
        e.stopPropagation();
        if (!this._ctxMenu) {
            return;
        }
        vscode.postMessage({ type: 'reset-to-commit', hash: this._ctxMenu.hash, shortHash: this._ctxMenu.shortHash });
        this._ctxMenu = null;
    }

    private _addTag(e: MouseEvent) {
        e.stopPropagation();
        if (!this._ctxMenu) {
            return;
        }
        vscode.postMessage({ type: 'add-tag', hash: this._ctxMenu.hash, shortHash: this._ctxMenu.shortHash });
        this._ctxMenu = null;
    }

    private _deleteTag(e: MouseEvent, tagName: string) {
        e.stopPropagation();
        if (!this._ctxMenu) {
            return;
        }
        vscode.postMessage({
            type: 'delete-tag',
            hash: this._ctxMenu.hash,
            shortHash: this._ctxMenu.shortHash,
            tagName,
        });
        this._ctxMenu = null;
    }

    private renderCtxMenu() {
        const open = this._ctxMenu !== null;
        const x = this._ctxMenu?.x ?? 0;
        const y = this._ctxMenu?.y ?? 0;
        const shortHash = this._ctxMenu?.shortHash ?? '';
        return html`
            <div
                class="ctx-menu"
                style=${styleMap({ left: `${x}px`, top: `${y}px`, display: open ? 'block' : 'none' })}
                @click=${(e: MouseEvent) => e.stopPropagation()}
            >
                <div class="ctx-menu-header">${shortHash}</div>
                <div class="ctx-menu-item" @click=${(e: MouseEvent) => this._switchToCommit(e)}>
                    <span>⎇</span> Basculer sur ce commit
                </div>
                <div class="ctx-menu-item" @click=${(e: MouseEvent) => this._cherryPick(e)}>
                    <span>🍒</span> Cherry-pick ce commit
                </div>
                <div class="ctx-menu-item" @click=${(e: MouseEvent) => this._revert(e)}>
                    <span>↩</span> Revert ce commit
                </div>
                <div class="ctx-menu-item" @click=${(e: MouseEvent) => this._rebaseInteractive(e)}>
                    <span>⤴</span> Rebase interactif depuis ici
                </div>
                <div class="ctx-menu-item" @click=${(e: MouseEvent) => this._addTag(e)}>
                    <span>🏷</span> Ajouter un tag…
                </div>
                ${(this._ctxMenu?.tags ?? []).map(
                    tag => html`
                        <div
                            class="ctx-menu-item ctx-menu-item--danger"
                            @click=${(e: MouseEvent) => this._deleteTag(e, tag)}
                        >
                            <span>🏷</span> Supprimer le tag « ${tag} »…
                        </div>
                    `,
                )}
                <div class="ctx-menu-separator"></div>
                <div class="ctx-menu-item ctx-menu-item--danger" @click=${(e: MouseEvent) => this._resetToCommit(e)}>
                    <span>↺</span> Reset ici…
                </div>
            </div>
        `;
    }

    private _matchesFilter(commit: CommitEntry, q: string): boolean {
        const lq = q.toLowerCase();
        return (
            commit.message.toLowerCase().includes(lq) ||
            commit.author.toLowerCase().includes(lq) ||
            commit.hash.startsWith(lq) ||
            commit.shortHash.startsWith(lq) ||
            commit.isoDate.includes(lq)
        );
    }

    private renderFlatRow(commit: CommitEntry) {
        const selected = commit.hash === this.selectedHash;
        return html`
            <div
                class="commit-row-flat ${selected ? 'selected' : ''}"
                @click=${() => this._selectCommit(commit.hash)}
                @contextmenu=${(e: MouseEvent) => this._openCtxMenu(e, commit)}
            >
                <div class="flat-dot ${selected ? 'selected' : ''}"></div>
                <div class="commit-message">
                    ${commit.refs.map(r => this.renderRef(r))}
                    <span class="message-text">${commit.message}</span>
                </div>
                <span class="commit-author">${commit.author}</span>
                <span class="commit-date">${commit.date}</span>
                <span class="hash">${commit.shortHash}</span>
            </div>
        `;
    }

    private renderCommitRow(row: GraphRow) {
        const selected = row.commit.hash === this.selectedHash;
        return html`
            <div
                class="commit-row ${selected ? 'selected' : ''}"
                @click=${() => this._selectCommit(row.commit.hash)}
                @contextmenu=${(e: MouseEvent) => this._openCtxMenu(e, row.commit)}
            >
                ${this.renderRowSvg(row)}
                <div class="commit-message">
                    ${row.commit.refs.map(r => this.renderRef(r, GRAPH_COLORS[row.colorIdx]))}
                    <span class="message-text">${row.commit.message}</span>
                </div>
                <span class="commit-author">${row.commit.author}</span>
                <span class="commit-date">${row.commit.date}</span>
                <span class="hash">${row.commit.shortHash}</span>
            </div>
        `;
    }

    // ── Render: file tree ─────────────────────────────────────────────────────

    private readonly _iconChevron = svg`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">
        <path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

    private readonly _iconFolder = svg`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="12" viewBox="0 0 16 14">
        <path d="M1 2h5l2 2h7v9H1z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    </svg>`;

    private readonly _iconFile = svg`<svg xmlns="http://www.w3.org/2000/svg" width="11" height="13" viewBox="0 0 11 13">
        <path d="M1 1h6l3 3v8H1z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
        <path d="M7 1v3h3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    </svg>`;

    private renderTreeNodes(nodes: TreeNode[], depth: number): unknown[] {
        return nodes.flatMap(n => this.renderTreeNode(n, depth));
    }

    private renderTreeNode(node: TreeNode, depth: number): unknown[] {
        const indent = 6 + depth * 14;

        const stat = html`
            <span class="tree-stat">
                ${node.added > 0 ? html`<span class="stat-add">+${node.added}</span>` : ''}
                ${node.removed > 0 ? html`<span class="stat-del"> -${node.removed}</span>` : ''}
            </span>
        `;

        if (node.isDir) {
            const open = !this._collapsedDirs.has(node.fullPath);
            return [
                html`
                    <div
                        class="tree-node"
                        style="padding-left:${indent}px"
                        @click=${() => this._toggleDir(node.fullPath)}
                    >
                        <span class="tree-chevron ${open ? 'open' : ''}">${this._iconChevron}</span>
                        <span class="tree-icon">${this._iconFolder}</span>
                        <span class="tree-name">${node.name}</span>
                        ${stat}
                    </div>
                `,
                ...(open ? this.renderTreeNodes(node.children, depth + 1) : []),
            ];
        }

        const selected = this._selectedFile === node.fullPath;
        return [
            html`
                <div
                    class="tree-node ${selected ? 'selected-file' : ''}"
                    style="padding-left:${indent + 14}px"
                    @click=${() => this._scrollToFile(node.fullPath)}
                >
                    <span class="tree-icon">${this._iconFile}</span>
                    <span class="tree-name">${node.name}</span>
                    ${stat}
                </div>
            `,
        ];
    }

    // ── Render: diff viewer ───────────────────────────────────────────────────

    private renderFileDiff(file: FileDiff) {
        const collapsed = this._collapsedFiles.has(file.path);
        const id = fileId(file.path);

        return html`
            <div class="diff-file" id="${id}">
                <div class="diff-file-header" @click=${() => this._toggleFile(file.path)}>
                    <span class="diff-chevron ${collapsed ? '' : 'open'}">${this._iconChevron}</span>
                    <span class="tree-icon" style="opacity:0.65">${this._iconFile}</span>
                    <span class="diff-file-path">${file.path}</span>
                    <span class="diff-file-stat">
                        ${file.added > 0 ? html`<span class="stat-add">+${file.added}</span>` : ''}
                        ${file.removed > 0 ? html`<span class="stat-del"> -${file.removed}</span>` : ''}
                    </span>
                </div>
                ${!collapsed
                    ? html`<div>
                          ${file.lines.map(
                              line => html` <span class="diff-line diff-${line.kind}">${line.content || ' '}</span>`,
                          )}
                      </div>`
                    : ''}
            </div>
        `;
    }

    // ── Render: detail pane ───────────────────────────────────────────────────

    private renderDetailPane() {
        if (!this.selectedHash) {
            return html`<div class="detail-empty">Sélectionnez un commit pour voir le détail</div>`;
        }
        if (this._diffLoading) {
            return html`<div class="detail-loading">Chargement du diff…</div>`;
        }
        if (this._diffError) {
            return html`<div class="detail-error">${this._diffError}</div>`;
        }
        if (!this._diffData) {
            return html`<div class="detail-empty"></div>`;
        }

        const d = this._diffData;
        const [subject, ...bodyLines] = d.body.split('\n');
        const bodyRest = bodyLines.join('\n').trim();

        return html`
            <div class="detail-header">
                <div class="detail-meta">
                    <span class="detail-hash">${d.hash.slice(0, 10)}</span>
                    <span class="detail-author">${d.author}</span>
                    <span class="detail-date">${d.date}</span>
                </div>
                <div class="detail-subject">${subject}</div>
                ${bodyRest ? html`<div class="detail-msgbody">${bodyRest}</div>` : ''}
            </div>
            <div class="detail-body">
                <div class="file-tree-pane">${this.renderTreeNodes(this._treeNodes, 0)}</div>
                <div class="diff-viewer">
                    ${(this._selectedFile ? d.files.filter(f => f.path === this._selectedFile) : d.files).map(f =>
                        this.renderFileDiff(f),
                    )}
                </div>
            </div>
        `;
    }

    render() {
        if (this.loading) {
            return html`<div class="state-msg">Chargement de l'historique…</div>`;
        }
        if (this.error) {
            return html`<div class="state-msg state-error">${this.error}</div>`;
        }

        const q = this._filterText.trim();
        const filteredCommits = q ? this.commits.filter(c => this._matchesFilter(c, q)) : null;

        return html`
            <div class="toolbar"><span class="toolbar-count">${this.commits.length}</span> commits</div>
            <div class="log-container ${this.selectedHash ? '' : 'no-selection'}">
                <div class="commits-pane">
                    <div class="filter-bar">
                        <input
                            class="filter-input"
                            type="text"
                            placeholder="Filtrer par message, auteur, SHA, date…"
                            .value=${this._filterText}
                            @input=${(e: InputEvent) => {
                                this._filterText = (e.target as HTMLInputElement).value;
                            }}
                        />
                        ${q
                            ? html`
                                  <span class="filter-count">${filteredCommits!.length} / ${this.commits.length}</span>
                                  <span
                                      class="filter-clear"
                                      title="Effacer le filtre"
                                      @click=${() => {
                                          this._filterText = '';
                                      }}
                                      >✕</span
                                  >
                              `
                            : ''}
                    </div>
                    <div class="commit-list">
                        ${filteredCommits
                            ? filteredCommits.map(c => this.renderFlatRow(c))
                            : html`
                                  <div class="header-row">
                                      <div class="graph-spacer" style="width:${this._graphWidth}px"></div>
                                      <div class="commit-message">Message</div>
                                      <span class="commit-author">Auteur</span>
                                      <span class="commit-date">Date</span>
                                      <span class="hash">Hash</span>
                                  </div>
                                  ${this._graphRows.map(r => this.renderCommitRow(r))}
                              `}
                    </div>
                </div>
                <div class="detail-pane">${this.renderDetailPane()}</div>
            </div>
            ${this.renderCtxMenu()}
        `;
    }
}

customElements.define('yogit-log', YogitLog);
