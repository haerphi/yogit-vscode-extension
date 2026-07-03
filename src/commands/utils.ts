import { API, Repository } from '@haerphi/vscode-git-api-types';
import * as vscode from 'vscode';

/**
 * Retourne le premier dépôt git détecté par vscode.git.
 *
 * On prend toujours repositories[0] car YoGit ne gère qu'un seul dépôt à la fois.
 * Si aucun dépôt n'est ouvert (workspace vide ou git non initialisé), on affiche
 * un message d'erreur et on retourne undefined — l'appelant doit vérifier et sortir.
 */
export function getRepo(gitApi: API): Repository | undefined {
    const repo = gitApi.repositories[0];
    if (!repo) {
        vscode.window.showErrorMessage(vscode.l10n.t('No git repository found'));
        return undefined;
    }
    return repo;
}

/**
 * Valide le nom d'une branche git saisi par l'utilisateur.
 * Utilisé comme callback `validateInput` des InputBox de création de branche.
 *
 * On n'implémente pas la spec complète des noms git (git check-ref-format) —
 * on bloque seulement les cas les plus courants qui causent des erreurs confuses.
 */
export function validateBranchName(value: string): string | undefined {
    if (!value.trim()) {
        return vscode.l10n.t('The name cannot be empty');
    }
    if (/\s/.test(value)) {
        return vscode.l10n.t('The name must not contain spaces');
    }
    return undefined;
}
