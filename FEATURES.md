# YorGit — Roadmap

## Fondations

- [x] Squelette de l'extension généré
- [x] Commande affichant la branche courante via `vscode.git`
- [x] Husky + lint-staged (Prettier + ESLint au commit)
- [x] Nettoyage du code template (suppression `helloWorld`)
- [x] Détection de si le dossier est un repository git, sinon proposer de l'initialiser ou de le lier à un repository existant

---

## Branches

- [x] TreeView listant les branches locales
- [x] TreeView listant les branches distantes
- [x] Action : créer une branche
- [x] Action : basculer sur une branche (switch)
- [x] Basculer sur une branche distante crée la branche locale avec tracking si elle n'existe pas (`git switch --track`)
- [x] Copier le nom d'une branche (menu contextuel, branches locales et distantes)
- [x] Action : renommer une branche locale (`git branch -m`)
- [x] Action : supprimer une branche locale / distante
- [x] Recherche/filtre des branches (vues Branches et Remotes) : bouton loupe dans la barre de titre ou Ctrl+F quand la vue a le focus, filtrage à la frappe, filtre actif affiché dans la description de la vue et effaçable d'un clic

---

## Remotes

- [x] Vue « Remotes » séparée : un groupe par remote (origin, upstream…), la vue branches ne liste que les branches locales
- [x] Ajouter un remote depuis la vue « Remotes »

---

## Changements locaux

- [x] Liste des fichiers modifiés (unstaged / staged / untracked)
- [x] Chemin relatif grisé à côté du nom de fichier (désambiguïsation des homonymes)
- [x] Staging / unstaging de fichiers individuels
- [x] Staging sélectif par hunks/lignes (diff parsing custom)
- [x] Bouton "Afficher tout le fichier" dans la vue diff (indexation/stash) — replie/déplie les régions de contexte éloignées d'un changement, sans jamais affecter la sélection des hunks/lignes
- [x] Menu contextuel "Changes" : ouvrir le fichier dans l'éditeur / copier le nom du fichier (Staged, Modifications, Conflits)
- [x] Stash partiel (sélection de fichiers)
- [x] Clic gauche sur un stash → aperçu de son contenu dans la même vue diff que "Changes" (lecture seule, sélection de fichier via QuickPick si le stash en touche plusieurs)
- [x] Déduplication des modales de confirmation (clé optionnelle dans `ConfirmModal.show`) — re-cliquer sur "Supprimer le stash" ramène la modale existante au lieu d'en empiler une nouvelle
- [x] Badge sur l'icône de la barre d'activité avec le nombre de fichiers modifiés

---

## Commits et synchronisation

- [x] Formulaire de création de commit (titre + description)
- [x] Amend du dernier commit (message + fichiers oubliés)
- [x] Synchronisation distante : Fetch / Pull / Push
- [x] Modale de push (branche, remote cible, tous les tags, mode normal / `--force-with-lease` / `--force` avec warning)
- [x] Le select "To" de la modale de push affiche `remote/branche` en direct (suit le select "Branch" via interpolation `${id}` générique dans ConfirmModal)

---

## Graphe et historique _(WebviewPanel)_

- [x] Historique des commits via `git log`
- [x] Graphe visuel des commits
- [x] Inspection d'un commit (diff détaillé) dans un onglet dédié par commit examiné
- [x] Scroll horizontal du diff dans l'inspection d'un commit (lignes longues visibles en entier, plus de troncature)
- [x] Filtres : par auteur, message, SHA, date
- [x] Copier le hash d'un commit dans le presse-papiers (menu contextuel de l'historique)
- [x] Survol d'une date relative ("11 days ago") → tooltip avec la date et l'heure exactes du commit (historique et rebase interactif)

---

## Opérations avancées

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
- [ ] Reflog (via `git reflog`, commande directe)

---

## Résolution des conflits

- [x] Section "Conflits" dédiée dans la vue Changes, affichée uniquement quand des fichiers sont en conflit (icône warning, clic → panneau de résolution)
- [x] Résolution visuelle des conflits (Current / Theirs / Final)
- [x] Clic sur le badge "N non résolu(s)" → défilement animé jusqu'au premier conflit non résolu
- [x] "Save and stage" ferme automatiquement la vue si le fichier n'a plus de conflit après le staging (vérifié via mergeChanges)
- [x] Menu contextuel fichier en conflit : "Prendre nos modifications" / "Prendre leurs modifications" (`git checkout --ours|--theirs`)
- [x] Bouton "Changements du fichier" (haut à droite) : bascule vers le diff complet nôtre↔entrant (`git diff :2 :3`) pour voir les modifications au-delà des conflits

---

## Blame

- [x] Blame de la ligne courante : annotation discrète en fin de ligne (auteur, date relative, sujet du commit) + entrée dans la barre d'état
- [x] Lignes non commitées annoncées comme telles ; les lignes écrites par l'utilisateur courant affichent « Vous » (comparaison sur `user.email`)
- [x] Blame du buffer en cours d'édition (`git blame --contents -`) : l'annotation reste juste même avant sauvegarde
- [x] Clic sur la barre d'état → inspection du commit de la ligne dans l'onglet dédié ; tooltip avec le message complet, l'auteur, la date exacte et des liens « Afficher le commit » / « Copier le hash »
- [x] Annotation masquée pendant une sélection ou en multi-curseur ; blame ligne par ligne + cache par version de document (coût constant quelle que soit la taille du fichier)

---

## Submodules

- [ ] Détection des submodules
- [ ] Affichage dans la TreeView
- [ ] Opérations de base sur les submodules

---

## Préférences configurables

- [x] `haerphi-yorgit.language` (auto/en/fr) — langue des webviews propres à YorGit (rebase, diff, conflits, log, commit). N'affecte pas les titres de commandes/notifications (`vscode.l10n.t()`), qui suivent toujours la langue d'affichage de VS Code — limitation de la plateforme, pas de notre code.
- [x] `haerphi-yorgit.rebase.defaultOrder` (oldest-first/newest-first) — sens d'affichage initial du rebase interactif, togglable ensuite depuis le panneau
- [x] `haerphi-yorgit.blame.inline` (bool, défaut vrai) — annotation blame en fin de ligne courante, basculable via la commande « Activer/désactiver le blame en ligne »
- [x] `haerphi-yorgit.blame.statusBar` (bool, défaut vrai) — blame de la ligne courante dans la barre d'état
- [x] `haerphi-yorgit.blame.delay` (ms, défaut 200) — délai avant de blâmer une ligne nouvellement ciblée

---

## Infrastructure

- [x] Internationalisation : anglais (défaut) + français — `package.nls*.json` pour le manifest, `vscode.l10n` + `l10n/bundle.l10n.fr.json` pour l'extension host, dictionnaires `pick(en, fr)` pour les webviews

- [x] Exécution git centralisée : helper `src/git/git-exec.ts` (`runGit`/`runGitBuffer`/`GitError`) — un seul point de spawn pour toutes les commandes d'action. Gère l'échec de démarrage du process (binaire introuvable, cwd invalide) et garantit un message d'erreur toujours non vide (stderr → stdout → code de sortie) pour un feedback exploitable

- [x] Canal de sortie « YorGit » : chaque commande git et sa sortie (stderr toujours, stdout à la demande) sont tracées. Le commit passe par child_process (au lieu de `repo.commit()`) pour capturer la sortie des hooks pre-commit/commit-msg (husky, lint-staged…) ; le canal est révélé automatiquement si un hook refuse le commit

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
