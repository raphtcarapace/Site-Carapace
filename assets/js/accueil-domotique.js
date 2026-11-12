// Bandeau catalogue et interactions de la proposition d'accueil.
// Les prix et les photos produit viennent de Firestore, comme sur la page actuelle.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());

const header = document.getElementById("site-header");
const onScroll = () => {
  header.classList.toggle("is-solid", window.scrollY > 24);
  document.getElementById("sticky-cta").classList.toggle("show", window.scrollY > 700);
};
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });
document.getElementById("to-top").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

const menu = document.getElementById("mobile-menu");
const burger = document.getElementById("burger");
function closeMenu() {
  menu.classList.remove("open");
  menu.setAttribute("aria-hidden", "true");
  burger.setAttribute("aria-expanded", "false");
  document.body.classList.remove("no-scroll");
}
burger.addEventListener("click", () => {
  const open = !menu.classList.contains("open");
  menu.classList.toggle("open", open);
  menu.setAttribute("aria-hidden", open ? "false" : "true");
  burger.setAttribute("aria-expanded", open ? "true" : "false");
  document.body.classList.toggle("no-scroll", open);
});
menu.querySelector("[data-close-menu]").addEventListener("click", closeMenu);
menu.addEventListener("click", (e) => { if (e.target.closest("a")) closeMenu(); });

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const reveals = document.querySelectorAll(".reveal");
if (reduce || !("IntersectionObserver" in window)) {
  reveals.forEach((el) => el.classList.add("in"));
} else {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.16 });
  reveals.forEach((el) => io.observe(el));
}

const rail = document.getElementById("domo-products");
document.getElementById("rail-next").addEventListener("click", () => rail.scrollBy({ left: 320, behavior: "smooth" }));
document.getElementById("rail-prev").addEventListener("click", () => rail.scrollBy({ left: -320, behavior: "smooth" }));

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function prixNombre(v) {
  const n = parseFloat(v);
  return isFinite(n) && n > 0 ? n : 0;
}
function prixLabel(v) {
  const n = prixNombre(v);
  if (!n) return "Sur devis";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
}
function marqueDe(p) {
  if (p.marque === "ajax") return "Ajax";
  if (p.marque === "somfy") return "Somfy";
  if (p.marque === "yale") return "Yale Home";
  return "";
}
function srcDe(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  return window.imageProduit ? window.imageProduit(s) : s;
}

try {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const snap = await getDocs(collection(db, "produits"));
  const items = [];
  snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
  const score = (p) => (p.a_la_une || p.est_a_la_une || p.featured ? 4 : 0) + (prixNombre(p.prix) ? 2 : 0) + (p.image ? 1 : 0);
  const picks = [];
  for (const marque of ["ajax", "somfy", "yale"]) {
    const groupe = items
      .filter((p) => p && p.nom && p.marque === marque && p.image)
      .sort((a, b) => score(b) - score(a) || String(a.nom).localeCompare(String(b.nom), "fr"));
    picks.push(...groupe.slice(0, 3));
  }
  if (!picks.length) {
    rail.innerHTML = '<p class="empty-state">Le catalogue ne renvoie aucun visuel pour le moment. <a href="index.html#ajax">Voir le site actuel</a>.</p>';
  } else {
    rail.innerHTML = picks.map((p) => {
      const src = srcDe(p.image);
      const href = `index.html#produit/${encodeURIComponent(p.id)}`;
      const paye = prixNombre(p.prix) > 0;
      return `<article class="card spot product-card${p.est_pack ? " pack" : ""}">
        <a class="p-open" href="${href}">
          <div class="p-media">
            ${p.est_pack ? '<div class="p-badges"><span class="badge red">Pack</span></div>' : ""}
            <img src="${esc(src)}" alt="${esc(p.nom)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='assets/img/logo-mark.png'">
          </div>
          <div class="p-body">
            <div class="p-brand">${esc(marqueDe(p))}</div>
            <div class="p-title">${esc(p.nom)}</div>
          </div>
        </a>
        <div class="p-foot">
          <span class="p-price">${esc(prixLabel(p.prix))}${paye ? "<small>TTC</small>" : ""}</span>
          <a class="btn ${paye ? "btn-primary" : "btn-outline"} btn-sm p-action" href="${href}">Voir la fiche</a>
        </div>
      </article>`;
    }).join("");
  }
} catch (e) {
  console.error(e);
  rail.innerHTML = '<p class="empty-state">Le catalogue est momentanément indisponible. <a href="index.html#ajax">Voir le site actuel</a>.</p>';
}
