# YoGit

Extension VS Code offrant une interface Git visuelle : claire, compacte, orientée action.

## Fonctionnalités

- **Vue des branches** : liste locale et distante avec la branche courante mise en évidence
- **Créer une branche** : depuis HEAD ou depuis n'importe quelle branche (locale ou distante)
- **Basculer** : clic simple ou clic droit → basculer / basculer en force (`git switch -f`)
- **Supprimer** : branche locale (avec option de supprimer la distante en même temps) ou branche distante (double confirmation)

## Prérequis

- VS Code 1.107+
- Extension [Git for VS Code](https://marketplace.visualstudio.com/items?itemName=vscode.git) (incluse par défaut)

## Développement

```bash
pnpm install

# Compiler (extension host + webview)
pnpm run compile

# OU

# Développement en parallèle (deux terminaux)
pnpm run watch:ext      # rechargement TypeScript extension host
pnpm run watch:webview  # rechargement esbuild webview Lit
```

Appuyer sur `F5` dans VS Code pour lancer une instance de débogage avec l'extension chargée.

## Installation manuelle (sans le marketplace)

Prérequis : [vsce](https://github.com/microsoft/vscode-vsce) (`npm install -g @vscode/vsce`)

```bash
# 1. Compiler l'extension
pnpm run compile

# 2. Générer le fichier .vsix
vsce package --no-dependencies

# 3. Installer dans VS Code
code --install-extension haerphi-yogit-*.vsix
```

Ou depuis VS Code : **Extensions → ⋯ → Installer depuis un fichier VSIX…** et sélectionner le `.vsix` généré.
