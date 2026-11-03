// Panier, commande et paiement PayPal (tout se passe dans le navigateur).
// Les prix et les noms enregistrés sont relus dans Firestore au moment de valider.
import { PAIEMENT } from "./paiement-config.js";

const CLE = "carapace-panier";
const CLE_CONFIRM = "carapace-confirmation";
const MAX_LIGNES = 50;
const MAX_QTE = 99;

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const eurFmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
function eur(n) { return eurFmt.format(n); }
function prixNombre(v) {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
    if (!isFinite(n)) return NaN;
    return Math.round(n * 100) / 100;
}
function totalDe(articles) {
    const cents = articles.reduce((s, a) => s + Math.round(a.prix * 100) * a.quantite, 0);
    return cents / 100;
}
function toast(msg, type) {
    if (window.Carapace && typeof window.Carapace.toast === "function") window.Carapace.toast(msg, type);
}

let lignes = lire();
let ouvert = false;
let verrou = null;          // snapshot Firestore + numéro, figé avant paiement
let paypalButtons = null;
let envoi = false;
let totalAffiche = null;

function lire() {
    try {
        const brut = JSON.parse(localStorage.getItem(CLE) || "[]");
        if (!Array.isArray(brut)) return [];
        const vus = new Set();
        const out = [];
        brut.forEach((l) => {
            const id = String(l && l.id || "").trim();
            const quantite = Math.max(1, Math.min(MAX_QTE, parseInt(l && l.quantite, 10) || 1));
            if (!id || id.length > 120 || vus.has(id)) return;
            vus.add(id);
            out.push({ id, quantite });
        });
        return out.slice(0, MAX_LIGNES);
    } catch (_) { return []; }
}
function sauver() {
    localStorage.setItem(CLE, JSON.stringify(lignes));
    rendreCompteur();
    rendreTiroir();
    invaliderVerrou();
}
function compter() { return lignes.reduce((s, l) => s + l.quantite, 0); }
function produitLocal(id) {
    return window.Carapace && typeof window.Carapace.getProduct === "function" ? window.Carapace.getProduct(id) : null;
}

function rendreCompteur() {
    const n = compter();
    const badge = $("#cart-count");
    const btn = $("#btn-panier");
    if (badge) {
        badge.textContent = n > 99 ? "99+" : String(n);
        badge.hidden = n === 0;
    }
    if (btn) btn.setAttribute("aria-label", n ? `Ouvrir le panier, ${n} article${n > 1 ? "s" : ""}` : "Ouvrir le panier");
}

function apercuLigne(l) {
    const p = produitLocal(l.id);
    const prix = p ? prixNombre(p.prix) : NaN;
    const nom = p && p.nom ? String(p.nom) : "Article";
    return { nom, prix, connu: isFinite(prix) && prix > 0 };
}

function rendreTiroir() {
    const liste = $("#panier-lignes");
    const totalEl = $("#panier-total");
    const vide = $("#panier-vide");
    const pied = $("#panier-pied");
    if (!liste) return;
    if (!lignes.length) {
        liste.innerHTML = "";
        if (vide) vide.hidden = false;
        if (pied) pied.hidden = true;
        return;
    }
    if (vide) vide.hidden = true;
    if (pied) pied.hidden = false;
    let cents = 0;
    let prixIncomplet = false;
    liste.innerHTML = lignes.map((l) => {
        const a = apercuLigne(l);
        if (!a.connu) prixIncomplet = true;
        else cents += Math.round(a.prix * 100) * l.quantite;
        return `<li class="panier-ligne">
            <div class="panier-nom"><b>${esc(a.nom)}</b><small>${a.connu ? esc(eur(a.prix)) + " TTC" : "Prix confirmé à la validation"}</small></div>
            <div class="panier-qte">
                <button type="button" data-qte="-1" data-id="${esc(l.id)}" aria-label="Diminuer la quantité">−</button>
                <span>${l.quantite}</span>
                <button type="button" data-qte="1" data-id="${esc(l.id)}" aria-label="Augmenter la quantité">+</button>
                <button type="button" class="panier-retrait" data-retirer="${esc(l.id)}" aria-label="Retirer ${esc(a.nom)}"><svg><use href="#i-x"/></svg></button>
            </div>
        </li>`;
    }).join("");
    if (totalEl) totalEl.textContent = prixIncomplet ? "—" : eur(cents / 100);
}

function ouvrir() {
    const drawer = $("#panier-drawer");
    if (!drawer) return;
    ouvert = true;
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
    const menuClose = document.querySelector("[data-close-menu]");
    if (document.getElementById("mobile-menu")?.classList.contains("open") && menuClose) menuClose.click();
    $("#btn-panier")?.setAttribute("aria-expanded", "true");
    rendreTiroir();
    setTimeout(() => $("#panier-fermer")?.focus(), 30);
}
function fermer() {
    const drawer = $("#panier-drawer");
    if (!drawer || !ouvert) return;
    ouvert = false;
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("no-scroll");
    $("#btn-panier")?.setAttribute("aria-expanded", "false");
}

function ajouter(id) {
    const pid = String(id || "").trim();
    if (!pid) return;
    const p = produitLocal(pid);
    const prix = p ? prixNombre(p.prix) : NaN;
    if (p && !(isFinite(prix) && prix > 0)) {
        toast("Ce produit est sur devis : utilisez « Demander un devis ».", "error");
        return;
    }
    const existante = lignes.find((l) => l.id === pid);
    if (existante) {
        if (existante.quantite >= MAX_QTE) { toast("Quantité maximale atteinte pour cet article.", "error"); return; }
        existante.quantite += 1;
    } else {
        if (lignes.length >= MAX_LIGNES) { toast("Le panier est limité à 50 articles différents.", "error"); return; }
        lignes.push({ id: pid, quantite: 1 });
    }
    sauver();
    toast("Ajouté au panier");
}
function changerQte(id, delta) {
    const l = lignes.find((x) => x.id === id);
    if (!l) return;
    l.quantite = Math.max(1, Math.min(MAX_QTE, l.quantite + delta));
    sauver();
}
function retirer(id) {
    lignes = lignes.filter((l) => l.id !== id);
    sauver();
}
function vider() {
    lignes = [];
    sauver();
}

function paypalDisponible() {
    return !!(PAIEMENT && String(PAIEMENT.PAYPAL_CLIENT_ID || "").trim());
}

function numeroCommande() {
    const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    const date = `${get("year")}${get("month")}${get("day")}`;
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    let suffixe = "";
    for (let i = 0; i < 4; i++) suffixe += alphabet[bytes[i] % alphabet.length];
    return `CMD-${date}-${suffixe}`;
}

function invaliderVerrou() {
    verrou = null;
    if (paypalButtons) { try { paypalButtons.close(); } catch (_) { /* déjà fermé */ } paypalButtons = null; }
    const slot = $("#paypal-buttons");
    if (slot) slot.innerHTML = "";
    const zone = $("#paypal-zone");
    if (zone) zone.hidden = true;
    const retry = $("#btn-reessayer-commande");
    if (retry) retry.hidden = true;
    const submit = $("#btn-valider-commande");
    if (submit) submit.hidden = false;
}

async function lireArticlesFirestore() {
    if (typeof window.CarapaceLireProduits !== "function") {
        throw new Error("Le catalogue est momentanément indisponible. Réessayez dans un instant.");
    }
    if (!lignes.length) throw new Error("Votre panier est vide.");
    const produits = await window.CarapaceLireProduits(lignes.map((l) => l.id));
    const articles = [];
    const retires = [];
    lignes.forEach((l) => {
        const p = produits[l.id];
        const prix = p ? prixNombre(p.prix) : NaN;
        const nom = p && p.nom ? String(p.nom).trim() : "";
        if (!p || !nom || !isFinite(prix) || prix <= 0 || prix >= 100000) { retires.push(l.id); return; }
        const quantite = Math.max(1, Math.min(MAX_QTE, l.quantite | 0));
        articles.push({ id: String(l.id).slice(0, 120), nom: nom.slice(0, 200), prix, quantite });
    });
    if (retires.length) {
        lignes = lignes.filter((l) => !retires.includes(l.id));
        sauver();
        throw new Error("Un article n'est plus vendu en ligne (sans prix ou retiré du catalogue). Le panier a été mis à jour.");
    }
    if (!articles.length || articles.length > MAX_LIGNES) throw new Error("Le panier ne contient aucun article commandable.");
    const total = totalDe(articles);
    if (!(total > 0) || total >= 100000) throw new Error("Le total de la commande n'est pas valable.");
    return { articles, total };
}

function afficherRecap(articles, total) {
    const ul = $("#commande-recap");
    totalAffiche = articles.length ? total : null;
    if (!ul) return;
    if (!articles.length) {
        ul.innerHTML = '<li class="recap-vide">Aucun article à commander.</li>';
        return;
    }
    ul.innerHTML = articles.map((a) => `<li><span>${esc(a.nom)} <small>× ${a.quantite}</small></span><b>${esc(eur(Math.round(a.prix * 100) * a.quantite / 100))}</b></li>`).join("")
        + `<li class="recap-total"><span>Total TTC</span><b>${esc(eur(total))}</b></li>`;
}

function champ(id) { return document.getElementById(id); }
function marquer(id, mauvais) {
    const input = champ(id);
    const groupe = input && input.closest(".form-group-contact");
    if (groupe) groupe.classList.toggle("invalid", mauvais);
    return !mauvais;
}
function telOk(v) {
    const s = v.trim();
    if (s.length < 8 || s.length > 20) return false;
    if (!/^[0-9+(). -]{8,20}$/.test(s)) return false;
    return s.replace(/\D/g, "").length >= 8;
}
function emailOk(v) {
    const s = v.trim();
    return s.length >= 6 && s.length <= 150 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function lireFormulaire() {
    const modeEl = document.querySelector('input[name="cmd-mode"]:checked');
    return {
        nom: champ("cmd-nom").value.trim(),
        prenom: champ("cmd-prenom").value.trim(),
        telephone: champ("cmd-telephone").value.trim(),
        email: champ("cmd-email").value.trim(),
        adresse: champ("cmd-adresse").value.trim(),
        code_postal: champ("cmd-cp").value.trim(),
        ville: champ("cmd-ville").value.trim(),
        message: champ("cmd-message").value.trim(),
        mode: modeEl ? modeEl.value : "rappel"
    };
}
function validerFormulaire() {
    const f = lireFormulaire();
    let ok = true;
    ok = marquer("cmd-nom", !(f.nom.length > 0 && f.nom.length <= 80)) && ok;
    ok = marquer("cmd-prenom", !(f.prenom.length > 0 && f.prenom.length <= 80)) && ok;
    ok = marquer("cmd-telephone", !telOk(f.telephone)) && ok;
    ok = marquer("cmd-email", !emailOk(f.email)) && ok;
    ok = marquer("cmd-adresse", !(f.adresse.length > 0 && f.adresse.length <= 200)) && ok;
    ok = marquer("cmd-cp", !/^[0-9]{5}$/.test(f.code_postal)) && ok;
    ok = marquer("cmd-ville", !(f.ville.length > 0 && f.ville.length <= 80)) && ok;
    ok = marquer("cmd-message", f.message.length > 2000) && ok;
    const err = $("#commande-erreur");
    if (f.mode === "en_ligne" && !paypalDisponible()) {
        ok = false;
        if (err) { err.textContent = "Le paiement en ligne n'est pas encore disponible. Choisissez « Être rappelé »."; err.hidden = false; }
    }
    if (!ok) {
        const premier = $(".form-group-contact.invalid input, .form-group-contact.invalid textarea, .form-group-contact.invalid select");
        if (premier) premier.focus();
    }
    return ok ? f : null;
}

function clientDe(f) {
    return {
        nom: f.nom,
        prenom: f.prenom,
        telephone: f.telephone,
        email: f.email,
        adresse: f.adresse,
        code_postal: f.code_postal,
        ville: f.ville
    };
}

function payloadDe(snapshot, mode, paypalOrderId) {
    // Champs EXACTEMENT ceux autorisés par firestore.rules (collection commandes).
    // La date (serverTimestamp) est ajoutée par CarapaceCreerCommande.
    return {
        numero: snapshot.numero,
        client: snapshot.client,
        articles: snapshot.articles.map((a) => ({ id: a.id, nom: a.nom, prix: a.prix, quantite: a.quantite })),
        total: snapshot.total,
        // Toujours false : les règles Firestore exigent le booléen, et l'achat en ligne est du matériel seul.
        installation: false,
        message: snapshot.message || "",
        mode: mode,
        paiement: mode === "en_ligne" ? "paye_en_ligne" : "a_encaisser",
        paypal_order_id: mode === "en_ligne" ? String(paypalOrderId || "") : "",
        statut: "nouvelle"
    };
}

async function enregistrer(snapshot, mode, paypalOrderId) {
    if (typeof window.CarapaceCreerCommande !== "function") {
        throw new Error("Connexion au service impossible pour le moment.");
    }
    const payload = payloadDe(snapshot, mode, paypalOrderId);
    await window.CarapaceCreerCommande(payload);
    return payload;
}

function afficherConfirmation(info) {
    const num = $("#confirm-numero");
    const texte = $("#confirm-texte");
    if (num) num.textContent = info.numero || "—";
    if (texte) {
        texte.textContent = info.mode === "en_ligne"
            ? "Votre paiement en ligne a été transmis. Carapace vérifie la réception sur son compte PayPal avant de préparer la commande. Conservez le numéro ci-dessous."
            : "Votre commande est enregistrée. Carapace vous rappelle pour la valider et encaisser le règlement. Conservez le numéro ci-dessous.";
    }
    try { sessionStorage.setItem(CLE_CONFIRM, JSON.stringify({ numero: info.numero, mode: info.mode, total: info.total })); } catch (_) { /* navigation privée */ }
    if (typeof window.setHash === "function") window.setHash("confirmation");
    if (typeof window.showPage === "function") window.showPage("confirmation");
    vider();
    invaliderVerrou();
    const form = $("#form-commande");
    if (form) form.reset();
    preparerModes();
}

function montrerErreur(msg) {
    const err = $("#commande-erreur");
    if (!err) return;
    err.textContent = msg;
    err.hidden = false;
}

async function preparerSnapshot(formulaire) {
    const frais = await lireArticlesFirestore();
    const precedent = totalAffiche;
    const snapshot = {
        numero: (verrou && verrou.numero) || numeroCommande(),
        client: clientDe(formulaire),
        articles: frais.articles,
        total: frais.total,
        installation: false,
        message: formulaire.message,
        mode: formulaire.mode
    };
    afficherRecap(snapshot.articles, snapshot.total);
    if (precedent != null && Math.round(precedent * 100) !== Math.round(snapshot.total * 100)) {
        verrou = null;
        throw new Error("Le prix d'un article vient d'être mis à jour. Vérifiez le total, puis validez à nouveau.");
    }
    verrou = snapshot;
    return snapshot;
}

function chargerSdkPayPal() {
    const id = String(PAIEMENT.PAYPAL_CLIENT_ID || "").trim();
    if (!id) return Promise.reject(new Error("PayPal non configuré"));
    if (window.paypal) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        const devise = PAIEMENT.CURRENCY || "EUR";
        s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(id)}&currency=${encodeURIComponent(devise)}&intent=capture&locale=fr_FR&enable-funding=card,paypal&disable-funding=paylater,venmo,credit`;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Le module de paiement n'a pas pu être chargé."));
        document.head.appendChild(s);
    });
}

async function afficherBoutonsPayPal(snapshot) {
    await chargerSdkPayPal();
    const slot = $("#paypal-buttons");
    const zone = $("#paypal-zone");
    if (!slot || !window.paypal) throw new Error("Paiement en ligne indisponible.");
    if (paypalButtons) { try { paypalButtons.close(); } catch (_) {} paypalButtons = null; }
    slot.innerHTML = "";
    if (zone) zone.hidden = false;
    // Le montant payé est celui relu dans Firestore (snapshot.total), pas le localStorage.
    paypalButtons = window.paypal.Buttons({
        style: { layout: "vertical", shape: "rect", label: "pay", color: "gold" },
        createOrder: (_data, actions) => actions.order.create({
            purchase_units: [{
                amount: { currency_code: PAIEMENT.CURRENCY || "EUR", value: snapshot.total.toFixed(2) },
                description: `Commande Carapace ${snapshot.numero}`.slice(0, 127)
            }]
        }),
        onApprove: async (data, actions) => {
            // Capture navigateur : l'admin doit quand même contrôler le compte PayPal avant d'expédier.
            const details = await actions.order.capture();
            if (!details || details.status !== "COMPLETED") {
                montrerErreur("Le paiement n'a pas été finalisé. Aucune commande n'a été enregistrée.");
                return;
            }
            try {
                await enregistrer(snapshot, "en_ligne", data.orderID);
                afficherConfirmation({ numero: snapshot.numero, mode: "en_ligne", total: snapshot.total });
            } catch (err) {
                console.error("Commande après paiement :", err);
                const retry = $("#btn-reessayer-commande");
                if (retry) { retry.hidden = false; retry.dataset.paypal = data.orderID; }
                montrerErreur(`Le paiement PayPal a été envoyé (référence ${data.orderID}) mais l'enregistrement de la commande a échoué. Ne payez pas une seconde fois : réessayez l'enregistrement ou contactez Carapace avec cette référence.`);
            }
        },
        onError: () => montrerErreur("Le paiement a été interrompu. Votre panier est conservé, vous pouvez réessayer.")
    });
    await paypalButtons.render(slot);
    const submit = $("#btn-valider-commande");
    if (submit) submit.hidden = true;
}

async function allerCommande() {
    if (!lignes.length) { toast("Votre panier est vide.", "error"); return; }
    fermer();
    if (typeof window.setHash === "function") window.setHash("commande");
    if (typeof window.showPage === "function") window.showPage("commande");
    const err = $("#commande-erreur");
    if (err) err.hidden = true;
    try {
        const frais = await lireArticlesFirestore();
        afficherRecap(frais.articles, frais.total);
    } catch (e) {
        afficherRecap([], 0);
        montrerErreur(e.message || "Impossible de lire le catalogue.");
    }
}

async function soumettreRappel(snapshot) {
    await enregistrer(snapshot, "rappel", "");
    afficherConfirmation({ numero: snapshot.numero, mode: "rappel", total: snapshot.total });
}

function preparerModes() {
    const enLigne = document.querySelector('input[name="cmd-mode"][value="en_ligne"]');
    const option = $("#pay-online-option");
    const soon = $("#pay-soon");
    const dispo = paypalDisponible();
    if (enLigne) enLigne.disabled = !dispo;
    if (option) option.classList.toggle("is-disabled", !dispo);
    if (soon) soon.hidden = dispo;
    if (!dispo && enLigne && enLigne.checked) {
        const rappel = document.querySelector('input[name="cmd-mode"][value="rappel"]');
        if (rappel) rappel.checked = true;
    }
    const submit = $("#btn-valider-commande");
    const mode = document.querySelector('input[name="cmd-mode"]:checked');
    if (submit) {
        submit.hidden = false;
        submit.textContent = mode && mode.value === "en_ligne" && dispo ? "Continuer vers le paiement" : "Valider ma commande — être rappelé";
    }
}

function restaurerConfirmation() {
    if (location.hash !== "#confirmation") return;
    try {
        const data = JSON.parse(sessionStorage.getItem(CLE_CONFIRM) || "null");
        if (data && data.numero) {
            const num = $("#confirm-numero");
            const texte = $("#confirm-texte");
            if (num) num.textContent = data.numero;
            if (texte) texte.textContent = data.mode === "en_ligne"
                ? "Votre paiement en ligne a été transmis. Carapace vérifie la réception sur son compte PayPal avant de préparer la commande. Conservez le numéro ci-dessous."
                : "Votre commande est enregistrée. Carapace vous rappelle pour la valider et encaisser le règlement. Conservez le numéro ci-dessous.";
        }
    } catch (_) { /* ignore */ }
}

function init() {
    rendreCompteur();
    preparerModes();
    restaurerConfirmation();

    document.addEventListener("click", (e) => {
        if (e.target.closest("#panier-drawer [data-page]")) fermer();
        if (e.target.closest("[data-open-cart]")) { e.preventDefault(); ouvrir(); return; }
        if (e.target.closest("#panier-fermer") || e.target.id === "panier-backdrop") { fermer(); return; }
        const qte = e.target.closest("[data-qte]");
        if (qte && $("#panier-drawer")?.contains(qte)) { changerQte(qte.getAttribute("data-id"), parseInt(qte.getAttribute("data-qte"), 10)); return; }
        const retirerBtn = e.target.closest("[data-retirer]");
        if (retirerBtn && $("#panier-drawer")?.contains(retirerBtn)) { retirer(retirerBtn.getAttribute("data-retirer")); return; }
        if (e.target.closest("#btn-panier-commander")) { e.preventDefault(); allerCommande(); }
    });

    document.addEventListener("carapace-catalogue", () => { if (ouvert) rendreTiroir(); });
    window.addEventListener("hashchange", restaurerConfirmation);
    window.addEventListener("popstate", restaurerConfirmation);

    const form = $("#form-commande");
    if (form) {
        form.addEventListener("input", () => {
            invaliderVerrou();
            const err = $("#commande-erreur");
            if (err) err.hidden = true;
        });
        form.addEventListener("change", (e) => {
            if (e.target.name === "cmd-mode") { invaliderVerrou(); preparerModes(); }
        });
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (envoi) return;
            const err = $("#commande-erreur");
            if (err) err.hidden = true;
            const f = validerFormulaire();
            if (!f) return;
            const btn = $("#btn-valider-commande");
            envoi = true;
            if (btn) btn.disabled = true;
            try {
                const snapshot = await preparerSnapshot(f);
                if (f.mode === "rappel") await soumettreRappel(snapshot);
                else await afficherBoutonsPayPal(snapshot);
            } catch (error) {
                console.error("Commande :", error);
                montrerErreur(error && error.message ? error.message : "La commande n'a pas pu être enregistrée. Merci de réessayer.");
            } finally {
                envoi = false;
                if (btn) btn.disabled = false;
            }
        });
    }

    $("#btn-reessayer-commande")?.addEventListener("click", async () => {
        if (!verrou || envoi) return;
        const id = $("#btn-reessayer-commande").dataset.paypal || "";
        envoi = true;
        try {
            await enregistrer(verrou, "en_ligne", id);
            afficherConfirmation({ numero: verrou.numero, mode: "en_ligne", total: verrou.total });
        } catch (error) {
            montrerErreur(error && error.message ? error.message : "Nouvel échec de l'enregistrement.");
        } finally { envoi = false; }
    });

    ["cmd-nom", "cmd-prenom", "cmd-telephone", "cmd-email", "cmd-adresse", "cmd-cp", "cmd-ville", "cmd-message"].forEach((id) => {
        champ(id)?.addEventListener("input", () => {
            const g = champ(id)?.closest(".form-group-contact");
            if (g && g.classList.contains("invalid")) validerFormulaire();
        });
    });
}

window.CarapacePanier = { ajouter, ouvrir, fermer, vider, compter };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
