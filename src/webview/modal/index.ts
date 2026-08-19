import './yorgit-modal';

// Créer et monter le composant après que le custom element soit défini.
// L'élément est créé ici (et non dans le HTML) pour s'assurer que window.__YORGIT_OPTIONS__
// est déjà disponible quand connectedCallback() s'exécute.
const modal = document.createElement('yorgit-modal');
document.body.appendChild(modal);
