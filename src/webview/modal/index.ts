import './yogit-modal';

// Créer et monter le composant après que le custom element soit défini.
// L'élément est créé ici (et non dans le HTML) pour s'assurer que window.__YOGIT_OPTIONS__
// est déjà disponible quand connectedCallback() s'exécute.
const modal = document.createElement('yogit-modal');
document.body.appendChild(modal);
