// Bandeau catalogue de la proposition d'accueil. Prix et noms viennent de Firestore.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const box = document.getElementById("domo-products");
const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function prixLabel(v) {
  const n = parseFloat(v);
  if (!isFinite(n) || n <= 0) return "Sur devis";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
}
function srcDe(url) {
  const s = String(url || "").trim();
  if (!s) return "assets/img/logo-mark.png";
  return window.imageProduit ? window.imageProduit(s) : s;
}

try {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const snap = await getDocs(collection(db, "produits"));
  const items = [];
  snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
  const picks = items
    .filter((p) => p && p.nom && p.image)
    .sort((a, b) => {
      const score = (p) => (p.a_la_une || p.est_a_la_une || p.featured ? 2 : 0) + (parseFloat(p.prix) > 0 ? 1 : 0);
      return score(b) - score(a) || String(a.nom).localeCompare(String(b.nom), "fr");
    })
    .slice(0, 6);
  if (!picks.length) {
    box.innerHTML = '<p class="domo-lead">Le catalogue ne renvoie aucun visuel pour le moment. <a href="index.html#ajax">Voir le site actuel</a>.</p>';
  } else {
    box.innerHTML = picks.map((p) => {
      const src = srcDe(p.image);
      const marque = p.marque === "ajax" ? "Ajax" : p.marque === "somfy" ? "Somfy" : p.marque === "yale" ? "Yale Home" : "";
      return `<a class="card domo-prod" href="index.html#produit/${esc(p.id)}">
        <img src="${esc(src)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='assets/img/logo-mark.png'">
        <b>${esc(p.nom)}</b>
        <small style="color:var(--muted)">${esc(marque)}</small>
        <span>${esc(prixLabel(p.prix))}</span>
      </a>`;
    }).join("");
  }
} catch (e) {
  console.error(e);
  box.innerHTML = '<p class="domo-lead">Le catalogue est momentanément indisponible. <a href="index.html#ajax">Voir le site actuel</a>.</p>';
}
