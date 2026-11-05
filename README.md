# Carapace : site vitrine v2

Site statique (HTML, CSS, JavaScript), sans étape de compilation. Il se publie tel quel sur GitHub Pages, Netlify, OVH, etc.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Le site public : accueil, configurateur, pages Ajax / Somfy / Yale, fiche produit, contact |
| `admin.html` | **Carapace Portail** : demandes clients, gestion du catalogue et **devis** (connexion Firebase) |
| `mentions-legales.html` | Mentions légales et RGPD (**à compléter**) |
| `404.html` | Page « introuvable » |
| `assets/css/style.css` | Design du site |
| `assets/css/admin.css` | Design du portail |
| `assets/js/site.js` | Interactions du site : navigation, recherche, filtres, configurateur, formulaire |
| `assets/js/firebase-config.js` | Configuration Firebase, identique à l'ancienne version |
| `assets/js/firebase-site.js` | Lecture du catalogue et envoi des demandes |
| `assets/js/admin.js` | Logique du portail |
| `assets/js/devis.js` | Onglet Devis : création, enregistrement (collection `devis`) et PDF |
| `assets/js/panier.js` | Panier, commande (rappel ou PayPal) et confirmation |
| `assets/js/paiement-config.js` | Client ID PayPal public (`PAYPAL_CLIENT_ID`, devise EUR) |
| `assets/js/entreprise-config.js` | **Vos infos d'entreprise** affichées sur les devis PDF (SIRET, adresse...) : **à compléter** |
| `assets/img/` | Images optimisées (WebP avec repli JPG/PNG), favicon, image de partage |
| `firestore.rules` | Règles de sécurité **prêtes à publier** (avec votre UID administrateur) |
| `firestore.rules.exemple` | Même chose avec `ADMIN_UID` à remplacer (modèle) |
| `robots.txt`, `sitemap.xml`, `site.webmanifest` | Référencement et icône d'application |

`logo.png`, `villa.png` et `tableau_kitajax.png` restent à la racine pour compatibilité : un produit de la base utilise `tableau_kitajax.png`.

## Tester sur votre ordinateur

Les modules Firebase ne fonctionnent pas si on ouvre le fichier en double-cliquant dessus. Lancez plutôt un petit serveur :

- **VS Code** : installez l'extension « Live Server », faites un clic droit sur `index.html` puis choisissez « Open with Live Server ».
- **Ou en terminal**, dans ce dossier : `python3 -m http.server 8000`, puis ouvrez http://localhost:8000

## À compléter avant la mise en ligne

Recherchez `À COMPLÉTER` dans tous les fichiers (Ctrl+Maj+F dans VS Code). Ces mentions sont surlignées en jaune sur le site pour ne pas les oublier.

## Sécurité (important)

Copiez **tout** le contenu de `firestore.rules` dans Console Firebase, puis Firestore Database, onglet Règles, puis **Publier**. Il contient déjà votre UID administrateur et les collections `devis` et `commandes`. Connectez-vous au portail avec **ce** compte. Ensuite :

- dans Authentication, désactivez la création de comptes par les visiteurs si elle est active ;
- vérifiez qu'il n'existe aucun autre compte que le vôtre.

## Devis (onglet « Devis » du portail)

- **Nouveau devis**, ou bouton **« Créer un devis »** sur une demande client : le client, le motif et le message sont repris automatiquement.
- Lignes **depuis le catalogue** (le prix TTC du catalogue est converti en HT selon la TVA choisie) ou **lignes libres** (installation, main d'œuvre, déplacement...).
- Quantités, remise (% ou €), TVA 20 / 10 / 5,5 / 0 % ou « TVA non applicable, art. 293 B du CGI », acompte.
- Numéro automatique `DEV-2026-0001`, date de validité, statut (brouillon, envoyé, accepté, refusé), recherche, duplication, suppression.
- **PDF** téléchargé sur votre appareil, à envoyer vous-même au client (le site n'envoie aucun e-mail).
- Complétez d'abord `assets/js/entreprise-config.js` (raison sociale, adresse, SIRET, assurance, conditions de paiement) : ces infos apparaissent sur chaque PDF.

## Commande en ligne

- Sur une fiche avec un prix TTC, le visiteur ajoute l'article au panier (mémorisé dans le navigateur). Un produit « Sur devis » (sans prix) ouvre le formulaire de contact, prérempli.
- À la validation, le site relit le nom et le prix dans Firestore, puis le client choisit **Être rappelé** (`paiement: a_encaisser`) ou **Payer en ligne**.
- Le paiement utilise le SDK PayPal (boutons PayPal et carte), sans serveur. Renseignez `PAYPAL_CLIENT_ID` dans `assets/js/paiement-config.js`. Tant qu'il est vide, « Payer en ligne » reste désactivé (« Bientôt disponible »).
- L'achat en ligne concerne le matériel seul, sans installation. Pour une pose, le visiteur passe par le formulaire de devis.
- Avant d'expédier, vérifiez dans votre compte PayPal que le paiement est bien reçu : un paiement confirmé seulement dans le navigateur du client n'est pas garanti par un serveur.
- L'onglet **Commandes** du portail suit les statuts. « Créer un devis depuis cette commande » ouvre le module devis déjà rempli.
- Numéro de commande : `CMD-AAAAMMJJ-XXXX`.

## Mise à jour du catalogue sans fil

Dans le portail, onglet **Catalogue**, panneau **Mise à jour du catalogue**, puis **Appliquer** (une confirmation est demandée). L'outil convertit une seule fois les prix Ajax HT en TTC, retire les deux produits Somfy filaires, et importe `assets/data/produits-sans-fil.json` en ignorant les noms déjà présents. Quand il n'y a plus rien à faire, le panneau affiche **Déjà appliqué**.

## Une demande n'apparaît pas dans le portail ?

1. Testez avec le site servi par Live Server ou en ligne, **jamais en double-cliquant** sur `index.html`.
2. Connectez-vous au portail avec le compte dont l'UID est écrit dans `firestore.rules`. Sinon le portail affiche « Accès refusé par les règles Firestore » avec l'UID utilisé.
3. Vérifiez que les règles sont bien **publiées**, puis cliquez sur « Actualiser ».
4. La demande doit aussi apparaître dans Console Firebase > Firestore Database > `demandes_contact`.
