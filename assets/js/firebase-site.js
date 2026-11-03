// Connexion du site vitrine à Firebase (Firestore) : lecture du catalogue
// et envoi des demandes de contact. Mêmes collections et mêmes champs qu'avant.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, getDocs, getDoc, doc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Envoi d'une demande (collection "demandes_contact")
window.CarapaceEnvoyerDemande = (data) => addDoc(collection(db, "demandes_contact"), data);

// Relecture des fiches au moment de valider une commande (prix et nom frais).
window.CarapaceLireProduits = async (ids) => {
    const uniques = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
    const produits = {};
    await Promise.all(uniques.map(async (id) => {
        const snap = await getDoc(doc(db, "produits", id));
        if (snap.exists()) produits[snap.id] = snap.data();
    }));
    return produits;
};

// Création d'une commande. `date` est toujours l'heure du serveur (request.time dans les règles).
// Le paiement en ligne n'est pas garanti par un serveur : l'admin contrôle le compte PayPal.
window.CarapaceCreerCommande = (data) => addDoc(collection(db, "commandes"), {
    numero: data.numero,
    client: data.client,
    articles: data.articles,
    total: data.total,
    installation: data.installation,
    message: data.message,
    mode: data.mode,
    paiement: data.paiement,
    paypal_order_id: data.paypal_order_id,
    statut: data.statut,
    date: serverTimestamp()
});

async function chargerCatalogue() {
    try {
        const snap = await getDocs(collection(db, "produits"));
        const produits = {};
        snap.forEach((d) => { produits[d.id] = d.data(); });
        window.Carapace && window.Carapace.setProducts(produits);
    } catch (error) {
        window.Carapace && window.Carapace.setError(error);
    }
}
chargerCatalogue();
