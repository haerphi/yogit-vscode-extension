#!/usr/bin/env bash
#
# release.sh — automatise une release de l'extension YorGit.
#
# Étapes :
#   1. Demande la nouvelle version à l'utilisateur (format attendu : vX.X.X)
#   2. Met à jour le champ "version" de package.json (sans le préfixe « v »)
#   3. Commite ce changement (message « Update package.json vX.X.X »)
#      — nécessaire pour que le tag et le push incluent le bump de version
#   4. Crée le tag vX.X.X
#   5. Pousse la branche courante et le tag sur origin
#
# Usage :
#   ./scripts/release.sh            # demande la version interactivement
#   ./scripts/release.sh v1.2.0     # version passée en argument

set -euo pipefail

# Se placer à la racine du dépôt, quel que soit le répertoire d'appel.
cd "$(dirname "$0")/.."

# ── 1. Version ────────────────────────────────────────────────────────────────
VERSION="${1:-}"
if [ -z "$VERSION" ]; then
    read -r -p "Nouvelle version (format vX.X.X) : " VERSION
fi

if ! [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "✗ Version invalide : « $VERSION ». Format attendu : vX.X.X (ex : v1.2.0)." >&2
    exit 1
fi

# package.json utilise le semver sans le « v » ; le tag git le conserve.
VERSION_NO_V="${VERSION#v}"

# ── Garde-fous ────────────────────────────────────────────────────────────────
# Arbre de travail propre : la release ne doit embarquer que le bump de version.
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "✗ L'arbre de travail n'est pas propre. Commitez ou remisez vos changements avant la release." >&2
    exit 1
fi

# Tag déjà existant ?
if git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null; then
    echo "✗ Le tag $VERSION existe déjà." >&2
    exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo
echo "  Version package.json : $VERSION_NO_V"
echo "  Tag git              : $VERSION"
echo "  Branche poussée      : $BRANCH → origin"
echo
read -r -p "Confirmer la release ? [y/N] " CONFIRM
if [[ ! "$CONFIRM" =~ ^[yY]$ ]]; then
    echo "Annulé."
    exit 0
fi

# ── 2. Mise à jour de package.json ────────────────────────────────────────────
# Remplacement ciblé de la clé "version" de premier niveau (indentée de 4 espaces)
# via sed, pour préserver le formatage exact du fichier. On dépend de sed plutôt
# que de node : sed est toujours présent dans l'environnement bash, node non.
if ! grep -qE '^    "version":[[:space:]]*"[^"]*",?$' package.json; then
    echo "✗ Champ \"version\" de premier niveau introuvable dans package.json." >&2
    exit 1
fi
sed -i -E "s/^(    \"version\":[[:space:]]*\")[^\"]*(\")/\1${VERSION_NO_V}\2/" package.json

# Vérifier que le remplacement a bien eu lieu avant de committer.
if ! grep -qE "^    \"version\":[[:space:]]*\"${VERSION_NO_V}\",?$" package.json; then
    echo "✗ La mise à jour de la version dans package.json a échoué." >&2
    exit 1
fi

# ── 3. Commit ─────────────────────────────────────────────────────────────────
git add package.json
git commit -m "Update package.json $VERSION"

# ── 4. Tag ────────────────────────────────────────────────────────────────────
git tag "$VERSION"

# ── 5. Push branche + tag ─────────────────────────────────────────────────────
git push origin "$BRANCH"
git push origin "$VERSION"

echo
echo "✓ Release $VERSION publiée (branche $BRANCH + tag poussés sur origin)."
