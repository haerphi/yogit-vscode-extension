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
- [x] Basculer sur une branche distante crée la branche locale avec tracking si elle n'existe pas (`git switch --track`)
- [x] Copier le nom d'une branche (menu contextuel, branches locales et distantes)
- [x] Action : supprimer une branche locale / distante

---

## Jalon 3 — Vue des changements locaux

Gestion de l'espace de travail courant.

- [x] Liste des fichiers modifiés (unstaged / staged / untracked)
- [x] Chemin relatif grisé à côté du nom de fichier (désambiguïsation des homonymes)
- [x] Staging / unstaging de fichiers individuels
- [x] Staging sélectif par hunks/lignes (diff parsing custom)
- [x] Bouton "Afficher tout le fichier" dans la vue diff (indexation/stash) — replie/déplie les régions de contexte éloignées d'un changement, sans jamais affecter la sélection des hunks/lignes
- [x] Stash partiel (sélection de fichiers)
- [x] Clic gauche sur un stash → aperçu de son contenu dans la même vue diff que "Changes" (lecture seule, sélection de fichier via QuickPick si le stash en touche plusieurs)
- [x] Badge sur l'icône de la barre d'activité avec le nombre de fichiers modifiés
- [x] Section "Conflits" dédiée dans la vue Changes, affichée uniquement quand des fichiers sont en conflit (icône warning, clic → panneau de résolution)

---

## Jalon 4 — Commits

Création et modification des commits.

- [x] Formulaire de création de commit (titre + description)
- [x] Amend du dernier commit (message + fichiers oubliés)
- [x] Synchronisation distante : Fetch / Pull / Push
- [x] Modale de push (branche, remote cible, tous les tags, mode normal / `--force-with-lease` / `--force` avec warning)
- [x] Le select "To" de la modale de push affiche `remote/branche` en direct (suit le select "Branch" via interpolation `${id}` générique dans ConfirmModal)

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
- [x] Code couleur par action dans le rebase interactif (bordure gauche + fond teinté par ligne : orange=reword, bleu=squash, violet=fixup, rouge+barré=drop, neutre=pick)
- [x] Glisser-déposer pour réordonner les commits du rebase interactif (en plus des flèches Haut/Bas, conservées pour l'accessibilité clavier)
- [x] Bouton pour inverser l'ordre d'affichage du rebase interactif (plus récent en haut) — vue seulement, l'ordre envoyé à git reste toujours plus ancien en premier
- [x] Volet "Aperçu" rétractable montrant le résultat final du rebase (squash/fixup fondus, drop exclus, reword avec le nouveau message) avant de cliquer sur "Lancer le rebase"
- [x] Ajouter un tag sur un commit (depuis l'historique, avec push optionnel)
- [x] Supprimer un tag (depuis l'historique, avec suppression distante optionnelle)
- [X]? Résolution visuelle des conflits (Current / Theirs / Final)
- [x] Clic sur le badge "N non résolu(s)" → défilement animé jusqu'au premier conflit non résolu
- [x] "Save and stage" ferme automatiquement la vue si le fichier n'a plus de conflit après le staging (vérifié via mergeChanges)
- [x] Détection de si le dossier est repository git, sinon proposé de l'initialisé ou le lié à un repository existant
- [x] Ajouter un remote depuis la vue « Remotes »
- [x] Vue « Remotes » séparée : un groupe par remote (origin, upstream…), la vue branches ne liste que les branches locales
- [ ] Reflog (via `git reflog`, commande directe)

---

## Jalon 7 — Submodules

- [ ] Détection des submodules
- [ ] Affichage dans la TreeView
- [ ] Opérations de base sur les submodules

---

## Préférences configurables

- [x] `haerphi-yogit.language` (auto/en/fr) — langue des webviews propres à YoGit (rebase, diff, conflits, log, commit). N'affecte pas les titres de commandes/notifications (`vscode.l10n.t()`), qui suivent toujours la langue d'affichage de VS Code — limitation de la plateforme, pas de notre code.
- [x] `haerphi-yogit.rebase.defaultOrder` (oldest-first/newest-first) — sens d'affichage initial du rebase interactif, togglable ensuite depuis le panneau

---

## Infrastructure

- [x] Internationalisation : anglais (défaut) + français — `package.nls*.json` pour le manifest, `vscode.l10n` + `l10n/bundle.l10n.fr.json` pour l'extension host, dictionnaires `pick(en, fr)` pour les webviews

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
