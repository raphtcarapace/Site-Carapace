# Carapace : site vitrine v2

Site statique (HTML, CSS, JavaScript), sans étape de compilation. Il se publie tel quel sur GitHub Pages, Netlify, OVH, etc.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Le site public : accueil, configurateur, pages Ajax / Somfy / Yale, fiche produit, contact |
| `admin.html` | **Carapace Portail** : demandes clients et gestion du catalogue (connexion Firebase) |
| `mentions-legales.html` | Mentions légales et RGPD (**à compléter**) |
| `404.html` | Page « introuvable » |
| `assets/css/style.css` | Design du site |
| `assets/css/admin.css` | Design du portail |
| `assets/js/site.js` | Interactions du site : navigation, recherche, filtres, configurateur, formulaire |
| `assets/js/firebase-config.js` | Configuration Firebase, identique à l'ancienne version |
| `assets/js/firebase-site.js` | Lecture du catalogue et envoi des demandes |
| `assets/js/admin.js` | Logique du portail |
| `assets/img/` | Images optimisées (WebP avec repli JPG/PNG), favicon, image de partage |
| `firestore.rules.exemple` | **Exemple** de règles de sécurité Firestore à publier dans la console |
| `robots.txt`, `sitemap.xml`, `site.webmanifest` | Référencement et icône d'application |

`logo.png`, `villa.png` et `tableau_kitajax.png` restent à la racine pour compatibilité : un produit de la base utilise `tableau_kitajax.png`.

## Tester sur votre ordinateur

Les modules Firebase ne fonctionnent pas si on ouvre le fichier en double-cliquant dessus. Lancez plutôt un petit serveur :

- **VS Code** : installez l'extension « Live Server », faites un clic droit sur `index.html` puis choisissez « Open with Live Server ».
- **Ou en terminal**, dans ce dossier : `python3 -m http.server 8000`, puis ouvrez http://localhost:8000

## À compléter avant la mise en ligne

Recherchez `À COMPLÉTER` dans tous les fichiers (Ctrl+Maj+F dans VS Code). Ces mentions sont surlignées en jaune sur le site pour ne pas les oublier.

## Sécurité (important)

Appliquez les règles de `firestore.rules.exemple` dans Console Firebase, puis Firestore Database, puis Règles. Remplacez d'abord `ADMIN_UID` par l'UID de votre compte. Ensuite :

- dans Authentication, désactivez la création de comptes par les visiteurs si elle est active ;
- vérifiez qu'il n'existe aucun autre compte que le vôtre.
