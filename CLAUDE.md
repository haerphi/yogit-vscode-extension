# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projet

Extension VS Code qui offre une interface Git visuelle: claire, compacte, orientée action.

## Stack

| Couche                  | Outil                                              |
| ----------------------- | -------------------------------------------------- |
| Langage                 | TypeScript strict                                  |
| Runtime extension       | VS Code Extension Host (Node.js)                   |
| Runtime webview         | Chromium embarqué VS Code                          |
| API Git de base         | `vscode.git` (via `@haerphi/vscode-git-api-types`) |
| Opérations avancées     | `child_process.spawn` avec `gitApi.git.path`       |
| Framework UI webview    | **Lit** (Web Components)                           |
| Bundler webview         | **esbuild**                                        |
| Qualité                 | ESLint + Prettier + Husky + lint-staged            |
| Gestionnaire de paquets | **pnpm**                                           |

## Commandes obligatoires après chaque modification

Toujours exécuter dans cet ordre avant de considérer une tâche terminée :

```bash
pnpm run format   # Prettier — formate tout le code
pnpm run lint     # ESLint — vérifie les règles (exclut src/webview)
pnpm run compile  # tsc (extension host) + esbuild (webview)
```

Si lint ou compile échoue, corriger avant de livrer.

### Développement (watch)

```bash
# Deux terminaux en parallèle
pnpm run watch:ext      # tsc --watch pour l'extension host
pnpm run watch:webview  # esbuild --watch pour le webview
```

### Tests

```bash
pnpm run test          # compile + lance vscode-test
pnpm run pretest       # compile + lint (appelé automatiquement avant test)
```

Les tests se trouvent dans `src/test/`. Ils nécessitent une instance VS Code (via `@vscode/test-electron`) — ils ne peuvent pas tourner en headless pur.

## Architecture

```
src/
├── commands/
│   ├── branch/               ← un fichier par action (create-branch.ts, switch.ts, …)
│   ├── register-commands.ts  ← point d'entrée unique, importe et enregistre tout
│   └── utils.ts              ← getRepo(), validateBranchName(), helpers partagés
├── git/
│   └── branches-provider.ts  ← TreeDataProvider, gère le cycle de vie du repo
├── types/
│   └── modal.ts              ← interfaces partagées extension host ↔ webview (sans import vscode)
├── ui/
│   └── ConfirmModal.ts       ← shell HTML + orchestration WebviewPanel
├── webview/
│   └── modal/
│       ├── yogit-modal.ts    ← composant Lit <yogit-modal>
│       └── index.ts          ← entry point esbuild
└── extension.ts              ← activate() minimal : init git API + enregistre tout
```

### Séparation extension host / webview

Le code sous `src/webview/` est compilé par **esbuild** (pas tsc) et tourne dans le navigateur Chromium du WebviewPanel.
Le code sous `src/` (hors `webview/`) est compilé par **tsc** et tourne dans Node.js (extension host).

`src/types/` est la seule zone partagée — ces fichiers ne doivent **jamais** importer `vscode` ou des modules Node.js.

### Flux de données webview

1. L'extension host crée un `WebviewPanel` et injecte les options dans `window.__YOGIT_OPTIONS__` via un `<script>` inline.
2. Le bundle `out/webview/modal.js` est chargé via une URI webview (`webview.asWebviewUri()`).
3. Le composant Lit lit les options dans `connectedCallback()` et rend l'UI.
4. Un clic de bouton envoie le résultat à l'extension host via `vscode.postMessage()`.
5. L'extension host reçoit le message via `panel.webview.onDidReceiveMessage()` et résout la Promise.

### Ajouter un nouveau WebviewPanel

1. Créer `src/webview/<nom>/` avec le composant Lit principal et un `index.ts` (entry point).
2. Ajouter une entrée esbuild dans le script `compile` de `package.json` :
   `esbuild src/webview/<nom>/index.ts --bundle --outfile=out/webview/<nom>.js --format=iife --platform=browser --tsconfig=tsconfig.webview.json`
3. Créer la classe d'orchestration correspondante dans `src/ui/`.
4. Déclarer `localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')]` sur le panel.

### Ajouter une nouvelle commande

1. Créer `src/commands/<catégorie>/<nom>.ts` avec une fonction `registerXxx(gitApi, provider?)` retournant un ou plusieurs `vscode.Disposable`.
2. L'importer dans `register-commands.ts` et l'ajouter au tableau retourné.
3. Déclarer la commande dans `package.json` → `contributes.commands`.
4. Si elle apparaît dans un menu contextuel : `package.json` → `contributes.menus` → `view/item/context` avec le bon `when`.
5. `extension.ts` ne doit **pas** être modifié.

### Flux de données extension

`extension.ts` → résout l'API `vscode.git` → instancie `BranchesProvider` → appelle `registerCommands(gitApi, provider)` → chaque commande reçoit `gitApi` (pour opérations git) et/ou `provider` (pour rafraîchir la vue).

### TreeView et `contextValue`

Les nœuds de la TreeView sont typés avec un discriminant `kind` :

- `kind: 'group'` — nœud groupe (Local / Distant), pas de `contextValue`, pas de menu clic droit.
- `kind: 'branch'` — nœud feuille, `contextValue = 'branch-local'` ou `'branch-remote'`, menus ciblés via `when: "viewItem =~ /^branch/"`.

Pour ajouter un sous-type (ex : branche avec remote tracking vs sans), créer un nouveau `contextValue` (ex: `'branch-tracked'`) et adapter le `when` dans `package.json`.

## Quirks connus de l'API `vscode.git`

- **`repo.state.HEAD` ne se met pas à jour automatiquement** après `repo.checkout()`. Appeler `await repo.status()` pour forcer la relecture de l'état et déclencher `repo.state.onDidChange`.
- **`repo.state.onDidChange`** est le seul événement fiable pour rafraîchir la TreeView. Ne pas appeler `provider.refresh()` manuellement sauf si l'opération git est faite hors de l'API (ex: `child_process.spawn`), auquel cas `provider.refresh()` est nécessaire après l'opération.
- **Compatibilité WSL** : utiliser `gitApi.git.path` comme exécutable (jamais `"git"` en dur). En mode Remote WSL, l'extension host tourne dans WSL — `child_process.spawn` et `repo.rootUri.fsPath` fonctionnent nativement. L'API Task VS Code (`vscode.tasks`) a des problèmes de validation avec les types `shell` et `process` — ne pas l'utiliser.
- **`repo.checkout()` vs `git switch`** : l'API n'expose que `checkout()`. Pour `git switch -f` (force), utiliser `child_process.spawn(gitApi.git.path, ['switch', '-f', branchName], { cwd: repo.rootUri.fsPath })`.
- **`getBranches()` vs `getBranch()`** : `getBranches()` retourne des `Ref` partiels sans `upstream`. Toujours appeler `getBranch(name)` quand les infos de tracking sont nécessaires.

## Quirks connus des WebviewPanels

- **`panel.onDidDispose` est synchrone** lors de `panel.dispose()` — utiliser un flag `resolved` pour éviter de résoudre la Promise deux fois (voir `ConfirmModal.ts`).
- **`acquireVsCodeApi()` ne peut être appelé qu'une seule fois** par webview — toujours l'appeler au niveau module, jamais dans une fonction.
- **CSS custom properties VS Code** (`--vscode-*`) sont héritées à travers le shadow DOM de Lit — les variables de thème fonctionnent directement dans `static styles`.

## Référence UI

- **Branche courante** : icône `$(check)` + description `"actuelle"`.
- **Menus contextuels** : grouper par catégorie avec des séparateurs nommés (`"1_switch"`, `"2_branch"`, etc.). Actions inline (`group: "inline"`) pour l'action principale uniquement, avec icône.
- **Actions destructrices** : toujours une modale de confirmation (`ConfirmModal`) avec un bandeau `warning` orange.
- **Nommage** : termes git francophones dans l'UI ("Basculer", "Créer", "Supprimer"), termes anglais dans le code.

## Règles de code

- **Commentaires** : commenter le _pourquoi_ uniquement (contournement bug API, invariant non-obvie). Jamais le _quoi_.
- **Pas de `any`** : utiliser les types stricts de `@haerphi/vscode-git-api-types` et `@types/vscode`.
- **Gestion d'erreur** : toujours `try/catch` autour des appels git, `vscode.window.showErrorMessage` avec un message lisible.
- **Disposables** : tout ce qui est créé dans `activate()` va dans `context.subscriptions`. Les listeners internes aux providers sont disposés dans `setRepository()` lors du remplacement.
- **Pas de `console.log`** : retirer avant de commiter.
- **Mettre à jour la ROADMAP**

## Roadmap (état actuel)

Jalon 2 terminé :

- [x] TreeView branches locales
- [x] TreeView branches distantes
- [x] Créer une branche
- [x] Basculer sur une branche (switch / switch -f)
- [x] Supprimer une branche locale / distante

Infrastructure webview :

- [x] Architecture Lit + esbuild pour les WebviewPanels
- [x] ConfirmModal refactorisée en composant Lit `<yogit-modal>`

- [x] Historique des commits via `git log` (WebviewPanel)
- [x] Graphe visuel des commits. lanes colorées + courbes de Bézier

- [x] Rebase simple (rebaser la branche courante sur une autre via menu contextuel)
- [x] Rebase interactif (pick/squash/fixup/drop + réordonnancement) — WebviewPanel `yogit-rebase`, déclenché depuis la TreeView branches ou depuis le menu contextuel de l'historique

Jalons suivants : blame → diff inline → résolution visuelle des conflits.
