/**
 * Formatage des dates de commit pour les webviews.
 *
 * Les vues affichent la date relative de git (%ar, "11 days ago") ; ce helper
 * produit la date absolue correspondante (%ai) à mettre en tooltip.
 */
import { isFrench } from './i18n';

/**
 * Convertit une date git `%ai` ("2024-06-15 10:30:00 +0200") en date/heure
 * locale lisible. Retourne '' si la date est absente, la chaîne brute si elle
 * n'est pas analysable.
 */
export function formatFullDate(isoDate: string): string {
    if (!isoDate) {
        return '';
    }
    // `%ai` sépare date/heure par un espace et préfixe l'offset d'un espace :
    // Date ne l'accepte que par tolérance, on le normalise en ISO 8601 strict.
    const normalized = isoDate.replace(' ', 'T').replace(' ', '');
    const d = new Date(normalized);
    if (isNaN(d.getTime())) {
        return isoDate;
    }
    return d.toLocaleString(isFrench() ? 'fr-FR' : 'en-US', {
        dateStyle: 'full',
        timeStyle: 'short',
    });
}
