import { LitElement, css, html, svg } from 'lit';
import { pick } from '../shared/i18n';

/**
 * Données du commit injectées par l'extension host dans `window.__YORGIT_COMMIT__`
 * (script inline nonce dans le shell HTML — voir CommitDetailPanel).
 */
interface CommitPayload {
    hash: string;
    shortHash: string;
    author: string;
    date: string;
    body: string;
    rawDiff: string;
}

declare global {
    interface Window {
        __YORGIT_COMMIT__?: CommitPayload;
    }
}

const L = pick(
    {
        noChanges: 'This commit introduces no file change.',
    },
    {
        noChanges: "Ce commit n'introduit aucune modification de fichier.",
    },
);

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
export class YorgitCommitDetail extends LitElement {
    static properties = {
        _collapsedFiles: { state: true },
        _collapsedDirs: { state: true },
        _selectedFile: { state: true },
    };

    declare _collapsedFiles: Set<string>;
    declare _collapsedDirs: Set<string>;
    declare _selectedFile: string;

    private _payload: CommitPayload | null = null;
    private _files: FileDiff[] = [];
    private _treeNodes: TreeNode[] = [];

    constructor() {
        super();
        this._collapsedFiles = new Set();
        this._collapsedDirs = new Set();
        this._selectedFile = '';
        this._payload = window.__YORGIT_COMMIT__ ?? null;
        if (this._payload) {
            this._files = parseDiff(this._payload.rawDiff);
            this._treeNodes = buildTree(this._files);
        }
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
        // Toggle: re-cliquer le même fichier → réaffiche tous les fichiers
        this._selectedFile = this._selectedFile === path ? '' : path;
    }

    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            height: 100vh;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            overflow: hidden;
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

        /* ── Body layout ── */
        .detail-body {
            flex: 1;
            display: flex;
            overflow: hidden;
        }

        /* ── File tree pane ── */
        .file-tree-pane {
            width: 240px;
            min-width: 160px;
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

        /* ── Empty state ── */
        .state-msg {
            padding: 24px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
    `;

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

    render() {
        const p = this._payload;
        if (!p) {
            return html`<div class="state-msg">${L.noChanges}</div>`;
        }

        const [subject, ...bodyLines] = p.body.split('\n');
        const bodyRest = bodyLines.join('\n').trim();

        return html`
            <div class="detail-header">
                <div class="detail-meta">
                    <span class="detail-hash">${p.hash.slice(0, 10)}</span>
                    <span class="detail-author">${p.author}</span>
                    <span class="detail-date">${p.date}</span>
                </div>
                <div class="detail-subject">${subject}</div>
                ${bodyRest ? html`<div class="detail-msgbody">${bodyRest}</div>` : ''}
            </div>
            ${this._files.length === 0
                ? html`<div class="state-msg">${L.noChanges}</div>`
                : html`
                      <div class="detail-body">
                          <div class="file-tree-pane">${this.renderTreeNodes(this._treeNodes, 0)}</div>
                          <div class="diff-viewer">
                              ${(this._selectedFile
                                  ? this._files.filter(f => f.path === this._selectedFile)
                                  : this._files
                              ).map(f => this.renderFileDiff(f))}
                          </div>
                      </div>
                  `}
        `;
    }
}

customElements.define('yorgit-commit-detail', YorgitCommitDetail);
