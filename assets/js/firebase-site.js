// Connexion du site vitrine à Firebase (Firestore) : lecture du catalogue
// et envoi des demandes de contact. Mêmes collections et mêmes champs qu'avant.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Envoi d'une demande (collection "demandes_contact")
window.CarapaceEnvoyerDemande = (data) => addDoc(collection(db, "demandes_contact"), data);

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
