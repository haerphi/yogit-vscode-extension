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

## Déploiement

Le build et la release sont automatisés via GitHub Actions ([`.github/workflows/build-release.yml`](.github/workflows/build-release.yml)) :

- **À chaque tag `vX.Y.Z`** : mêmes étapes, puis création d'une release GitHub avec le `.vsix` en pièce jointe et des notes de version générées automatiquement.

Pour publier une nouvelle version :

```bash
# 1. Mettre à jour le champ "version" dans package.json (ex: 1.1.0), puis commiter
git add package.json
git commit -m "release: v1.1.0"
git push

# 2. Créer et pousser le tag correspondant
git tag v1.1.0
git push origin v1.1.0
```

Le workflow vérifie que le tag correspond à la version du `package.json` : en cas de différence, le build échoue et aucune release n'est créée.
