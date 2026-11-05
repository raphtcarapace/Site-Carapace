// ===================== CARAPACE PORTAIL =====================
// Mêmes appels Firebase que la version d'origine (Auth + Firestore),
// mêmes collections ("produits", "demandes_contact") et mêmes champs.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { initDevis } from "./devis.js";
import { initCatalogueMaj } from "./catalogue-maj.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let modeEdition = false;
let idEditionCourant = null;
let contactsData = [];
window.produitsData = {};

const $ = (id) => document.getElementById(id);

// ---------- Sécurité : échappement de tout ce qui vient de la base ----------
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function safeUrl(u) {
    const s = String(u || '').trim();
    if (!s) return '';
    if (/^(javascript|data|vbscript):/i.test(s)) return '';
    return s;
}
const IMG_PH = 'assets/img/logo-mark.png';
function produitSrc(u) {
    const safe = safeUrl(u);
    if (!safe) return '';
    return window.imageProduit ? window.imageProduit(safe) : safe;
}
function imgOnError() {
    return ` onerror="this.onerror=null;this.src='${IMG_PH}'"`;
}
function fmtPrix(p) {
    const n = parseFloat(p);
    return isFinite(n) ? n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' : '—';
}
function toDate(d) {
    if (!d) return null;
    if (typeof d.toDate === 'function') return d.toDate();
    if (d.seconds) return new Date(d.seconds * 1000);
    const x = new Date(d);
    return isNaN(x) ? null : x;
}

// ---------- Notifications ----------
function toast(msg, type = 'ok') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.innerHTML = `<svg class="i"><use href="#${type === 'ok' ? 'i-check-circle' : 'i-x'}"/></svg><span>${esc(msg)}</span>`;
    $('toasts').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 3200);
    setTimeout(() => t.remove(), 3700);
}

// ---------- Thème clair / sombre ----------
const themeToggle = $('theme-toggle');
function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('carapace-admin-theme', theme);
    if (themeToggle) {
        themeToggle.innerHTML = `<svg class="i"><use href="#${theme === 'dark' ? 'i-sun' : 'i-moon'}"/></svg>`;
        themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre');
    }
}
applyTheme(localStorage.getItem('carapace-admin-theme') || 'light');
themeToggle && themeToggle.addEventListener('click', () => {
    applyTheme(document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});
document.querySelectorAll('.year').forEach((e) => (e.textContent = new Date().getFullYear()));

// ---------- Onglets ----------
function ouvrirOnglet(id) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === id));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === id));
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => ouvrirOnglet(t.dataset.tab)));

// ---------- Devis ----------
const devis = initDevis({ db, toast, ouvrirOnglet, getProduits: () => window.produitsData || {} });
const catalogueMaj = initCatalogueMaj({
    db,
    toast,
    getProduits: () => window.produitsData || {},
    apres: () => chargerProduitsAdmin()
});

// ---------- Catégories ----------
const categoriesParMarque = {
    ajax: [
        "Boîtiers", "Boutons & télécommandes", "Centrales", "Claviers",
        "Détecteurs de bris de glace", "Détecteurs de mouvements",
        "Détecteurs d'ouverture", "Kits de démarrage", "Modules d'intégration",
        "Modules d'interphonie", "Prolongateurs de portée", "Relais", "Sirènes", "Unités d'alimentation",
        "Détecteurs d'incendie", "Déclencheurs manuels d'alarme", "Caméras Wi-Fi",
        "Prises portables intelligentes", "Détecteurs de fuites", "Vannes d'arrêt",
        "Détecteurs de qualité de l'air"
    ],
    yale: [
        "Maison connectée", "Serrures connectées", "Coffres-forts",
        "Alarmes", "Caméras", "Equipements de porte", "Cadenas et antivols"
    ],
    somfy: []
};
const nomsMarques = { ajax: 'Ajax', somfy: 'Somfy', yale: 'Yale Home' };

const selectMarque = $('marque');
const selectCategorie = $('categorie');
const groupCategorie = $('group-categorie');
const labelCategorie = $('label-categorie');

function mettreAJourCategories() {
    const marque = selectMarque.value;
    selectCategorie.innerHTML = '<option value="">-- Sélectionnez une catégorie --</option>';
    if (categoriesParMarque[marque] && categoriesParMarque[marque].length > 0) {
        categoriesParMarque[marque].forEach((cat) => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.text = cat;
            selectCategorie.appendChild(opt);
        });
        groupCategorie.style.display = 'block';
        labelCategorie.innerText = `Sous-catégorie (${marque.toUpperCase()})`;
    } else {
        groupCategorie.style.display = 'none';
    }
    majApercu();
}
selectMarque.addEventListener('change', mettreAJourCategories);

// ---------- Aperçu en direct ----------
function majApercu() {
    const img = produitSrc($('image').value);
    const pvImg = $('pv-img');
    pvImg.onerror = function () { this.onerror = null; this.src = IMG_PH; };
    if (img) { pvImg.src = img; pvImg.hidden = false; $('pv-ph').hidden = true; }
    else { pvImg.removeAttribute('src'); pvImg.hidden = true; $('pv-ph').hidden = false; }
    pvImg.onload = () => { $('pv-ph').textContent = 'Le visuel principal apparaîtra ici'; };
    const cat = selectCategorie.value;
    $('pv-brand').textContent = (nomsMarques[selectMarque.value] || '') + (cat ? ' · ' + cat : '');
    $('pv-name').textContent = $('nom').value.trim() || "Nom de l'équipement";
    $('pv-desc').textContent = $('desc').value.trim() || "La description courte s'affiche sur la vignette du catalogue.";
    const prix = parseFloat($('prix').value);
    $('pv-price').textContent = isFinite(prix) && prix > 0 ? fmtPrix(prix) + ' TTC' : 'Sur devis';
    const pack = $('pack').checked, une = $('a_la_une').checked;
    $('pv-card').classList.toggle('is-pack', pack);
    $('pv-tags').innerHTML = (pack ? '<span class="badge">PACK</span>' : '') + (une ? '<span class="badge blue">À LA UNE</span>' : '');
    const sec = $('images_secondaires').value.split(/[,\n]/).map((s) => produitSrc(s.trim())).filter(Boolean).slice(0, 8);
    $('pv-thumbs').innerHTML = sec.map((s) => `<img src="${esc(s)}" alt="" loading="lazy"${imgOnError()}>`).join('');
}
['image', 'nom', 'desc', 'prix', 'images_secondaires', 'pack', 'a_la_une', 'categorie'].forEach((id) => {
    $(id).addEventListener('input', majApercu);
    $(id).addEventListener('change', majApercu);
});
mettreAJourCategories();

// ---------- Statistiques ----------
function afficherStatsDashboard(contactCount = 0, produits = []) {
    const totalProduits = produits.length;
    const packsCount = produits.filter((p) => p.est_pack).length;
    const marquesCount = new Set(produits.map((p) => p.marque).filter(Boolean)).size;
    $('stat-demandes').innerText = String(contactCount);
    $('stat-produits').innerText = String(totalProduits);
    $('stat-packs').innerText = String(packsCount);
    $('stat-marques').innerText = String(marquesCount);
    $('tab-count-demandes').innerText = String(contactCount);
    $('catalog-count').innerText = String(totalProduits);
}

// ---------- Authentification ----------
onAuthStateChanged(auth, (user) => {
    if (user) {
        $('auth-screen').style.display = 'none';
        $('portal-content').style.display = 'block';
        $('user-display').innerText = `Connecté : ${user.email}`;
        const h = new Date().getHours();
        $('hello').innerText = (h >= 18 || h < 5 ? 'Bonsoir' : 'Bonjour') + ' 👋';
        chargerContactsAdmin();
        chargerProduitsAdmin();
        devis.chargerDevis();
        ecouterCommandes();
    } else {
        if (typeof arretCommandes === 'function') arretCommandes();
        $('auth-screen').style.display = '';
        $('portal-content').style.display = 'none';
    }
});

$('quick-add-product').addEventListener('click', () => {
    ouvrirOnglet('panel-catalogue');
    $('form-produit').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('nom').focus({ preventScroll: true });
});

$('refresh-dashboard').addEventListener('click', async () => {
    await chargerContactsAdmin();
    await chargerProduitsAdmin();
    await devis.chargerDevis();
    ecouterCommandes();
    toast('Données actualisées');
});

$('toggle-password').addEventListener('click', () => {
    const inp = $('login-password');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    $('toggle-password').setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
});

$('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('btn-login-submit');
    const errP = $('auth-error');
    errP.style.display = 'none';
    btn.innerText = "Connexion...";
    btn.disabled = true;
    try {
        const emailClean = $('login-email').value.trim();
        const passClean = $('login-password').value;
        await signInWithEmailAndPassword(auth, emailClean, passClean);
    } catch (err) {
        errP.innerText = err && err.code === 'auth/too-many-requests'
            ? "Trop de tentatives. Réessayez dans quelques minutes."
            : "Identifiant ou mot de passe incorrect.";
        errP.style.display = 'block';
    } finally {
        btn.innerText = "Se connecter";
        btn.disabled = false;
    }
});

$('btn-reset-password').addEventListener('click', async () => {
    const email = $('login-email').value.trim();
    const errP = $('auth-error');
    if (!email) {
        errP.innerText = "Saisissez d'abord votre adresse e-mail ci-dessus.";
        errP.style.display = 'block';
        $('login-email').focus();
        return;
    }
    try {
        await sendPasswordResetEmail(auth, email);
    } catch (e) { /* message neutre volontaire */ }
    errP.style.display = 'none';
    toast("Si ce compte existe, un e-mail de réinitialisation vient d'être envoyé.");
});

$('btn-logout').addEventListener('click', () => signOut(auth));

// ---------- Demandes de contact ----------
async function chargerContactsAdmin() {
    const tbody = $('tbody-contacts');
    const mobileContainer = $('cards-contacts-mobile');
    try {
        const querySnapshot = await getDocs(collection(db, "demandes_contact"));
        contactsData = [];
        querySnapshot.forEach((docSnap) => contactsData.push({ id: docSnap.id, ...docSnap.data() }));
        // Les plus récentes en premier
        contactsData.sort((a, b) => ((toDate(b.date) || 0) - (toDate(a.date) || 0)));

        afficherStatsDashboard(contactsData.length, Object.values(window.produitsData || {}));

        const raisons = [...new Set(contactsData.map((c) => c.raison).filter(Boolean))].sort();
        const sel = $('admin-filter-raison');
        const cur = sel.value;
        sel.innerHTML = '<option value="all">Tous les motifs</option>' + raisons.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
        if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;

        afficherContacts();
    } catch (e) {
        console.error(e);
        // Diagnostic clair : le cas le plus fréquent est un compte non autorisé par les règles Firestore
        const u = auth.currentUser;
        const msg = e && e.code === 'permission-denied'
            ? `<strong>Accès refusé par les règles Firestore.</strong><br>Le compte connecté (${esc(u ? u.email : '?')}) a l'UID <code>${esc(u ? u.uid : '?')}</code>.
               Cet UID doit être celui écrit dans vos règles Firestore (fonction estAdmin), et les règles doivent être <em>publiées</em> dans la console Firebase.`
            : `Erreur de chargement des demandes${e && e.code ? ' (' + esc(e.code) + ')' : ''}. Vérifiez votre connexion internet puis cliquez sur « Actualiser ».`;
        tbody.innerHTML = `<tr><td colspan='6' class='empty diag'>${msg}</td></tr>`;
        mobileContainer.innerHTML = `<div class='empty diag'>${msg}</div>`;
    }
}

function afficherContacts() {
    const tbody = $('tbody-contacts');
    const mobileContainer = $('cards-contacts-mobile');
    const q = $('admin-search-contacts').value.toLowerCase().trim();
    const r = $('admin-filter-raison').value;
    tbody.innerHTML = "";
    mobileContainer.innerHTML = "";

    if (contactsData.length === 0) {
        const emptyMsg = "Aucune demande de devis reçue pour le moment.";
        tbody.innerHTML = `<tr><td colspan='6' class='empty'>${emptyMsg}</td></tr>`;
        mobileContainer.innerHTML = `<div class='empty'>${emptyMsg}</div>`;
        return;
    }

    const liste = contactsData.filter((d) => {
        const okR = r === 'all' || d.raison === r;
        const txt = [d.nom, d.prenom, d.contact, d.raison, d.message].join(' ').toLowerCase();
        return okR && (!q || txt.includes(q));
    });

    if (liste.length === 0) {
        tbody.innerHTML = "<tr><td colspan='6' class='empty'>Aucune demande ne correspond à votre recherche.</td></tr>";
        mobileContainer.innerHTML = "<div class='empty'>Aucune demande ne correspond à votre recherche.</div>";
        return;
    }

    liste.forEach((d) => {
        const id = d.id;
        const dt = toDate(d.date);
        const dateFormatted = dt ? dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
        const contact = String(d.contact || '');
        const isPhone = /^[0-9+ .-]+$/.test(contact.replace(/\s/g, ''));
        const contactLink = contact ? (isPhone ? `tel:${contact.replace(/[^0-9+]/g, '')}` : `mailto:${contact}`) : '#';
        const nomComplet = esc(`${d.nom || ''} ${d.prenom || ''}`.trim() || 'Sans nom');

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="white-space: nowrap;">${esc(dateFormatted)}</td>
            <td><strong>${nomComplet}</strong></td>
            <td><a href="${esc(contactLink)}" class="contact-link">${esc(contact) || '—'}</a></td>
            <td><span class="badge">${esc(d.raison || '—')}</span></td>
            <td class="msg-cell">${d.message ? esc(d.message) : '<em>Aucune précision</em>'}</td>
            <td style="white-space:nowrap;"><button class="btn-sm-edit" data-devis-contact="${esc(id)}"><svg class="i"><use href="#i-file"/></svg>Créer un devis</button> <button class="btn-sm-del" data-del-contact="${esc(id)}" title="Supprimer"><svg class="i"><use href="#i-trash"/></svg></button></td>`;
        tbody.appendChild(tr);

        const card = document.createElement('div');
        card.className = "contact-card-mobile";
        card.innerHTML = `
            <div class="contact-card-header">
                <span class="contact-card-name">${nomComplet}</span>
                <span class="contact-card-date">${esc(dateFormatted)}</span>
            </div>
            <span class="contact-card-badge badge">${esc(d.raison || '—')}</span>
            <div class="contact-card-info"><a href="${esc(contactLink)}" class="contact-link">${esc(contact) || '—'}</a></div>
            ${d.message ? `<div class="contact-card-msg">${esc(d.message)}</div>` : ''}
            <div class="contact-card-footer">
                <a href="${esc(contactLink)}" class="btn-sm">Contacter</a>
                <button class="btn-sm-edit" data-devis-contact="${esc(id)}">Créer un devis</button>
                <button class="btn-sm-del" data-del-contact="${esc(id)}">Supprimer</button>
            </div>`;
        mobileContainer.appendChild(card);
    });
}
$('admin-search-contacts').addEventListener('input', afficherContacts);
$('admin-filter-raison').addEventListener('change', afficherContacts);
document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-del-contact]');
    if (b) window.supprimerContact(b.getAttribute('data-del-contact'));
    const dv = e.target.closest('[data-devis-contact]');
    if (dv) {
        const dem = contactsData.find((c) => c.id === dv.getAttribute('data-devis-contact'));
        if (dem) devis.creerDepuisDemande(dem);
    }
});

window.supprimerContact = async function (id) {
    if (confirm("Confirmer la suppression de cette demande de contact ?")) {
        try {
            await deleteDoc(doc(db, "demandes_contact", id));
            toast('Demande supprimée');
        } catch (e) { toast('Erreur : ' + e.message, 'err'); }
        chargerContactsAdmin();
    }
};

// Export CSV (compatible Excel, séparateur ;)
$('btn-export-csv').addEventListener('click', () => {
    if (!contactsData.length) { toast('Aucune demande à exporter', 'err'); return; }
    const cell = (v) => '"' + String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
    const lignes = [['Date', 'Nom', 'Prénom', 'Contact', 'Motif', 'Message'].map(cell).join(';')];
    contactsData.forEach((d) => {
        const dt = toDate(d.date);
        lignes.push([dt ? dt.toLocaleString('fr-FR') : '', d.nom, d.prenom, d.contact, d.raison, d.message].map(cell).join(';'));
    });
    const blob = new Blob(['\ufeff' + lignes.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `demandes-carapace-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- Produits ----------
async function chargerProduitsAdmin() {
    try {
        const querySnapshot = await getDocs(collection(db, "produits"));
        window.produitsData = {};
        const produits = [];
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            window.produitsData[docSnap.id] = data;
            produits.push(data);
        });
        const contactCount = parseInt($('stat-demandes').textContent, 10) || 0;
        afficherStatsDashboard(contactCount, produits);
        filtrerProduitsAdmin();
    } catch (e) {
        console.error(e);
        $('tbody-produits').innerHTML = "<tr><td colspan='5' class='empty' style='color:var(--red);'>Erreur de chargement.</td></tr>";
    }
    if (catalogueMaj) await catalogueMaj.rafraichir();
}

window.filtrerProduitsAdmin = function () {
    const tbody = $('tbody-produits');
    const searchVal = $('admin-search-prod').value.toLowerCase().trim();
    const brandVal = $('admin-filter-brand').value;
    tbody.innerHTML = "";
    const ids = Object.keys(window.produitsData);

    if (ids.length === 0) {
        tbody.innerHTML = "<tr><td colspan='5' class='empty'>Aucun produit dans le catalogue.</td></tr>";
        return;
    }
    // Tri : marque puis nom
    ids.sort((a, b) => {
        const A = window.produitsData[a], B = window.produitsData[b];
        return String(A.marque || '').localeCompare(String(B.marque || '')) || String(A.nom || '').localeCompare(String(B.nom || ''), 'fr');
    });

    let nbCorrespondances = 0;
    ids.forEach((id) => {
        const data = window.produitsData[id];
        const matchMarque = (brandVal === 'all') || (data.marque === brandVal);
        const matchRecherche = searchVal === "" ||
            (data.nom && data.nom.toLowerCase().includes(searchVal)) ||
            (data.categorie && data.categorie.toLowerCase().includes(searchVal)) ||
            (data.description && data.description.toLowerCase().includes(searchVal));

        if (matchMarque && matchRecherche) {
            nbCorrespondances++;
            const une = data.a_la_une || data.est_a_la_une || data.featured;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><img src="${esc(produitSrc(data.image) || IMG_PH)}" class="miniature-img" alt="" loading="lazy"${imgOnError()}></td>
                <td>
                    <strong>${esc(data.nom)}</strong>
                    ${data.est_pack ? ' <span class="badge">PACK</span>' : ''}
                    ${une ? ' <span class="badge blue">À LA UNE</span>' : ''}
                    ${data.categorie ? `<div style="font-size:11.5px; color:var(--muted); margin-top:2px;">${esc(data.categorie)}</div>` : ''}
                </td>
                <td><span class="badge dark">${esc(nomsMarques[data.marque] || data.marque || '—')}</span></td>
                <td style="font-weight:800; white-space:nowrap;">${esc(isFinite(parseFloat(data.prix)) && parseFloat(data.prix) > 0 ? fmtPrix(data.prix) : 'Sur devis')}</td>
                <td style="white-space:nowrap;">
                    <button class="btn-sm-edit" data-act="edit" data-id="${esc(id)}"><svg class="i"><use href="#i-edit"/></svg>Modifier</button>
                    <button class="btn-sm" data-act="dup" data-id="${esc(id)}" title="Dupliquer"><svg class="i"><use href="#i-copy"/></svg></button>
                    <button class="btn-sm-del" data-act="del" data-id="${esc(id)}" title="Supprimer"><svg class="i"><use href="#i-trash"/></svg></button>
                </td>`;
            tbody.appendChild(tr);
        }
    });

    if (nbCorrespondances === 0) {
        tbody.innerHTML = "<tr><td colspan='5' class='empty'>Aucun équipement ne correspond à votre recherche.</td></tr>";
    }
};

$('tbody-produits').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.getAttribute('data-id');
    if (b.dataset.act === 'edit') window.preparerEdition(id);
    if (b.dataset.act === 'del') window.supprimerProduit(id);
    if (b.dataset.act === 'dup') dupliquerProduit(id);
});

function remplirFormulaire(data) {
    selectMarque.value = data.marque;
    mettreAJourCategories();
    if (data.categorie) selectCategorie.value = data.categorie;
    $('nom').value = data.nom || '';
    $('prix').value = data.prix ?? '';
    $('image').value = data.image || '';
    $('images_secondaires').value = (data.images_secondaires || []).join(', ');
    $('desc').value = data.description || '';
    $('desc_longue').value = (data.description_longue || '').replace(/<br\s*\/?>/g, '\n');
    $('pack').checked = data.est_pack || false;
    $('a_la_une').checked = !!(data.a_la_une || data.est_a_la_une || data.featured);
    majApercu();
}

window.preparerEdition = function (id) {
    const data = window.produitsData[id];
    if (!data) return;
    modeEdition = true;
    idEditionCourant = id;
    remplirFormulaire(data);
    $('form-prod-title').innerText = "✏️ Modifier le produit";
    $('btn-save-prod').innerText = "💾 Enregistrer les modifications";
    $('btn-cancel-edit').style.display = "inline-flex";
    $('edit-banner').classList.add('show');
    ouvrirOnglet('panel-catalogue');
    $('form-produit').closest('.card-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function dupliquerProduit(id) {
    const data = window.produitsData[id];
    if (!data) return;
    window.annulerEdition();
    remplirFormulaire({ ...data, nom: (data.nom || '') + ' (copie)' });
    $('form-prod-title').innerText = "➕ Ajouter un équipement (copie)";
    $('form-produit').closest('.card-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('Fiche copiée dans le formulaire : modifiez puis ajoutez.');
}

window.annulerEdition = function () {
    modeEdition = false;
    idEditionCourant = null;
    $('form-produit').reset();
    mettreAJourCategories();
    $('form-prod-title').innerText = "➕ Ajouter un équipement";
    $('btn-save-prod').innerText = "➕ Ajouter au catalogue";
    $('btn-cancel-edit').style.display = "none";
    $('edit-banner').classList.remove('show');
};

window.supprimerProduit = async function (id) {
    if (confirm("Confirmer la suppression définitive de cet équipement ?")) {
        try {
            await deleteDoc(doc(db, "produits", id));
            if (idEditionCourant === id) window.annulerEdition();
            delete window.produitsData[id];
            filtrerProduitsAdmin();
            afficherStatsDashboard(contactsData.length, Object.values(window.produitsData));
            toast('Produit supprimé');
        } catch (e) { toast('Erreur : ' + e.message, 'err'); }
    }
};

$('form-produit').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('btn-save-prod');
    btn.innerText = "Sauvegarde...";
    btn.disabled = true;
    try {
        const photosSecondaires = $('images_secondaires').value
            .split(/[,\n]/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);

        const aLaUne = $('a_la_une').checked;
        const produitData = {
            marque: selectMarque.value,
            categorie: selectCategorie.value !== "" ? selectCategorie.value : null,
            nom: $('nom').value.trim(),
            prix: parseFloat($('prix').value),
            image: $('image').value.trim(),
            images_secondaires: photosSecondaires,
            description: $('desc').value.trim(),
            description_longue: $('desc_longue').value.trim().replace(/\n/g, '<br>'),
            est_pack: $('pack').checked,
            a_la_une: aLaUne,
            est_a_la_une: aLaUne,
            featured: aLaUne
        };

        if (modeEdition && idEditionCourant) {
            await updateDoc(doc(db, "produits", idEditionCourant), produitData);
            toast("Produit mis à jour.");
            window.annulerEdition();
        } else {
            produitData.date_ajout = new Date();
            await addDoc(collection(db, "produits"), produitData);
            toast("Produit ajouté au catalogue.");
            $('form-produit').reset();
            mettreAJourCategories();
        }
        chargerProduitsAdmin();
    } catch (err) {
        toast("Erreur : " + err.message, 'err');
    } finally {
        btn.innerText = modeEdition ? "💾 Enregistrer les modifications" : "➕ Ajouter au catalogue";
        btn.disabled = false;
    }
});

// ---------- Commandes en ligne ----------
const STATUTS_CMD = {
    nouvelle: 'Nouvelle',
    confirmee: 'Confirmée',
    en_preparation: 'En préparation',
    installee: 'Installée',
    livree: 'Livrée',
    annulee: 'Annulée'
};
const PAIEMENTS_CMD = { a_encaisser: 'À encaisser', paye_en_ligne: 'Payé en ligne', paye: 'Payé' };
const MODES_CMD = { rappel: 'Être rappelé', en_ligne: 'Paiement en ligne' };
let commandesData = [];
let commandeOuverte = null;
let unsubCommandes = null;

function arretCommandes() {
    if (unsubCommandes) { unsubCommandes(); unsubCommandes = null; }
}

function eurCmd(n) {
    const x = Number(n);
    return isFinite(x) ? x.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : '—';
}

function ecouterCommandes() {
    arretCommandes();
    unsubCommandes = onSnapshot(collection(db, 'commandes'), (snap) => {
        commandesData = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        commandesData.sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0));
        const nouvelles = commandesData.filter((c) => c.statut === 'nouvelle').length;
        $('tab-count-commandes').textContent = String(nouvelles);
        afficherCommandes();
        if (commandeOuverte) {
            const encore = commandesData.find((c) => c.id === commandeOuverte);
            if (encore) rendreDetailCommande(encore);
            else fermerDetailCommande();
        }
    }, (e) => {
        console.error('Commandes :', e);
        const msg = e && e.code === 'permission-denied'
            ? 'Accès refusé. Publiez les règles Firestore (collection commandes) puis reconnectez-vous avec le compte administrateur.'
            : 'Impossible de charger les commandes.';
        $('tbody-commandes').innerHTML = `<tr><td colspan="8" class="empty diag">${esc(msg)}</td></tr>`;
        $('cards-commandes-mobile').innerHTML = `<div class="empty diag">${esc(msg)}</div>`;
    });
}

function afficherCommandes() {
    const q = $('admin-search-commandes').value.toLowerCase().trim();
    const filtre = $('admin-filter-commandes').value;
    const tbody = $('tbody-commandes');
    const mobile = $('cards-commandes-mobile');
    const liste = commandesData.filter((c) => {
        if (filtre !== 'all' && c.statut !== filtre) return false;
        if (!q) return true;
        const client = c.client || {};
        const txt = [c.numero, client.nom, client.prenom, client.email, client.telephone, client.ville, c.message].join(' ').toLowerCase();
        return txt.includes(q);
    });
    if (!liste.length) {
        const msg = commandesData.length ? 'Aucune commande ne correspond à votre recherche.' : 'Aucune commande pour le moment.';
        tbody.innerHTML = `<tr><td colspan="8" class="empty">${msg}</td></tr>`;
        mobile.innerHTML = `<div class="empty">${msg}</div>`;
        return;
    }
    tbody.innerHTML = '';
    mobile.innerHTML = '';
    liste.forEach((c) => {
        const client = c.client || {};
        const nom = `${client.prenom || ''} ${client.nom || ''}`.trim() || 'Sans nom';
        const dt = toDate(c.date);
        const date = dt ? dt.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="white-space:nowrap">${esc(date)}</td>
            <td><strong>${esc(c.numero || '—')}</strong></td>
            <td>${esc(nom)}<div class="sub">${esc(client.ville || '')}</div></td>
            <td>${esc(eurCmd(c.total))}</td>
            <td>${esc(MODES_CMD[c.mode] || c.mode || '—')}</td>
            <td><span class="statut-pill s-${esc(c.statut)}">${esc(STATUTS_CMD[c.statut] || c.statut || '—')}</span></td>
            <td>${esc(PAIEMENTS_CMD[c.paiement] || c.paiement || '—')}</td>
            <td><button class="btn-sm-edit" type="button" data-voir-commande="${esc(c.id)}">Voir</button></td>`;
        tbody.appendChild(tr);

        const card = document.createElement('div');
        card.className = 'contact-card-mobile';
        card.innerHTML = `
            <div class="contact-card-header">
                <span class="contact-card-name">${esc(c.numero || 'Commande')}</span>
                <span class="contact-card-date">${esc(date)}</span>
            </div>
            <span class="contact-card-badge badge">${esc(STATUTS_CMD[c.statut] || c.statut || '—')}</span>
            <div class="contact-card-info"><strong>${esc(nom)}</strong> · ${esc(eurCmd(c.total))}</div>
            <div class="contact-card-msg">${esc(MODES_CMD[c.mode] || '')} · ${esc(PAIEMENTS_CMD[c.paiement] || '')}${client.ville ? ' · ' + esc(client.ville) : ''}</div>
            <div class="contact-card-footer">
                <button class="btn-sm-edit" type="button" data-voir-commande="${esc(c.id)}">Voir le détail</button>
            </div>`;
        mobile.appendChild(card);
    });
}

function optionsHtml(map, courant) {
    return Object.entries(map).map(([k, label]) => `<option value="${esc(k)}"${k === courant ? ' selected' : ''}>${esc(label)}</option>`).join('');
}

function rendreDetailCommande(c) {
    commandeOuverte = c.id;
    const client = c.client || {};
    const nom = `${client.prenom || ''} ${client.nom || ''}`.trim();
    const tel = String(client.telephone || '').replace(/[^0-9+]/g, '');
    const articles = Array.isArray(c.articles) ? c.articles : [];
    $('cmd-detail-titre').textContent = c.numero || 'Commande';
    $('commande-detail').hidden = false;
    $('cmd-detail-body').innerHTML = `
        <div class="cmd-grid">
            <div>
                <p><strong>${esc(nom || 'Sans nom')}</strong></p>
                <p><a class="contact-link" href="tel:${esc(tel)}">${esc(client.telephone || '—')}</a></p>
                <p><a class="contact-link" href="mailto:${esc(client.email || '')}">${esc(client.email || '—')}</a></p>
                <p class="hint">Adresse de livraison</p>
                <p>${esc(client.adresse || '')}<br>${esc(client.code_postal || '')} ${esc(client.ville || '')}</p>
            </div>
            <div>
                <p>Mode : <strong>${esc(MODES_CMD[c.mode] || c.mode || '—')}</strong></p>
                <p>Paiement : <strong>${esc(PAIEMENTS_CMD[c.paiement] || c.paiement || '—')}</strong></p>
                ${c.paypal_order_id ? `<p class="hint">Réf. PayPal : ${esc(c.paypal_order_id)}</p>` : ''}
                <p class="cmd-total">Total TTC : ${esc(eurCmd(c.total))}</p>
            </div>
        </div>
        ${c.paiement === 'paye_en_ligne' ? '<p class="cmd-warn">Vérifiez dans votre compte PayPal que ce paiement est bien reçu avant d’expédier. Un paiement confirmé seulement dans le navigateur du client n’est pas garanti par un serveur.</p>' : ''}
        <table class="cmd-articles"><thead><tr><th>Article</th><th>Qté</th><th>Prix TTC</th></tr></thead><tbody>
            ${articles.map((a) => `<tr><td>${esc(a.nom || a.id || '')}</td><td>${esc(a.quantite)}</td><td>${esc(eurCmd(a.prix))}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Aucun article</td></tr>'}
        </tbody></table>
        ${c.message ? `<p class="contact-card-msg">${esc(c.message)}</p>` : ''}
        <div class="cmd-actions">
            <label>Statut <select id="cmd-statut">${optionsHtml(STATUTS_CMD, c.statut)}</select></label>
            <label>Paiement <select id="cmd-paiement">${optionsHtml(PAIEMENTS_CMD, c.paiement)}</select></label>
            <button class="btn btn-primary" type="button" id="cmd-sauver">Enregistrer</button>
            <button class="btn btn-secondary" type="button" id="cmd-vers-devis"><svg class="i"><use href="#i-file"/></svg>Créer un devis depuis cette commande</button>
            <button class="btn btn-secondary" type="button" id="cmd-suppr">Supprimer</button>
        </div>`;
    $('cmd-sauver').onclick = () => sauverCommande(c.id);
    $('cmd-vers-devis').onclick = () => devis.creerDepuisCommande(c);
    $('cmd-suppr').onclick = () => supprimerCommande(c);
    $('commande-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fermerDetailCommande() {
    commandeOuverte = null;
    $('commande-detail').hidden = true;
    $('cmd-detail-body').innerHTML = '';
}

async function sauverCommande(id) {
    const statut = $('cmd-statut').value;
    const paiement = $('cmd-paiement').value;
    try {
        await updateDoc(doc(db, 'commandes', id), { statut, paiement });
        toast('Commande mise à jour');
    } catch (e) {
        toast('Erreur : ' + (e.message || 'mise à jour refusée'), 'err');
    }
}

async function supprimerCommande(c) {
    if (!confirm(`Supprimer définitivement la commande ${c.numero || ''} ?`)) return;
    try {
        await deleteDoc(doc(db, 'commandes', c.id));
        if (commandeOuverte === c.id) fermerDetailCommande();
        toast('Commande supprimée');
    } catch (e) {
        toast('Erreur : ' + (e.message || 'suppression refusée'), 'err');
    }
}

$('admin-search-commandes').addEventListener('input', afficherCommandes);
$('admin-filter-commandes').addEventListener('change', afficherCommandes);
$('cmd-detail-fermer').addEventListener('click', fermerDetailCommande);
document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-voir-commande]');
    if (!b) return;
    const c = commandesData.find((x) => x.id === b.getAttribute('data-voir-commande'));
    if (c) rendreDetailCommande(c);
});
