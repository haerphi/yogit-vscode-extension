# YoGit — Roadmap

## Jalon 1 — Fondations _(en cours)_

Mise en place de l'infrastructure de base de l'extension.

- [x] Squelette de l'extension généré
- [x] Commande affichant la branche courante via `vscode.git`
- [x] Husky + lint-staged (Prettier + ESLint au commit)6
- [x] Nettoyage du code template (suppression `helloWorld`)

---

## Jalon 2 — Vue des branches

Première vraie interface utilisateur : une TreeView listant les branches.

- [x] TreeView listant les branches locales
- [x] TreeView listant les branches distantes
- [x] Action : créer une branche
- [x] Action : basculer sur une branche (switch)
- [x] Action : supprimer une branche locale / distante

---

## Jalon 3 — Vue des changements locaux

Gestion de l'espace de travail courant.

- [x] Liste des fichiers modifiés (unstaged / staged / untracked)
- [x] Chemin relatif grisé à côté du nom de fichier (désambiguïsation des homonymes)
- [x] Staging / unstaging de fichiers individuels
- [x] Staging sélectif par hunks/lignes (diff parsing custom)
- [x] Stash partiel (sélection de fichiers)
- [x] Badge sur l'icône de la barre d'activité avec le nombre de fichiers modifiés

---

## Jalon 4 — Commits

Création et modification des commits.

- [x] Formulaire de création de commit (titre + description)
- [x] Amend du dernier commit (message + fichiers oubliés)
- [x] Synchronisation distante : Fetch / Pull / Push

---

## Jalon 5 — Graphe et historique _(WebviewPanel)_

Visualisation de l'historique du dépôt. Nécessite `child_process` + WebviewPanel.

- [x] Historique des commits via `git log`
- [x] Graphe visuel des commits
- [x] Inspection d'un commit (diff détaillé en parallèle du graphe)
- [x] Filtres : par auteur, message, SHA, date

---

## Jalon 6 — Opérations avancées

- [x] Cherry-pick
- [x] Revert (commit inverse)
- [x] Rebase simple
- [x] Rebase interactif (réordonner, squash/fixup, drop) _(WebviewPanel)_
- [x] Ajouter un tag sur un commit (depuis l'historique, avec push optionnel)
- [x] Supprimer un tag (depuis l'historique, avec suppression distante optionnelle)
- [X]? Résolution visuelle des conflits (Current / Theirs / Final)
- [x] Détection de si le dossier est repository git, sinon proposé de l'initialisé ou le lié à un repository existant
- [ ] Reflog (via `git reflog`, commande directe)

---

## Jalon 7 — Submodules

- [ ] Détection des submodules
- [ ] Affichage dans la TreeView
- [ ] Opérations de base sur les submodules

---

## Infrastructure

- [x] CI GitHub Actions : lint + compile + packaging `.vsix` sur chaque push/PR vers `main`
- [x] Release automatique : push d'un tag `vX.Y.Z` → build + release GitHub avec le `.vsix` en pièce jointe

---

## Stack technique

| Couche                               | Outil                                         |
| ------------------------------------ | --------------------------------------------- |
| Opérations Git de base               | `vscode.git` API                              |
| Opérations avancées                  | `child_process.exec` (commandes git directes) |
| UI riche (graphe, rebase interactif) | `WebviewPanel`                                |
| Qualité de code                      | ESLint + Prettier + Husky + lint-staged       |
