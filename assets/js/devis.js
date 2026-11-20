// ===================== CARAPACE PORTAIL : DEVIS =====================
// Création, enregistrement (collection Firestore "devis", accès admin uniquement)
// et génération PDF au modèle Alu'Topia. Aucun envoi d'e-mail depuis le site.
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ENTREPRISE } from "./entreprise-config.js";
import { genererDevisPdf } from "./devis-pdf.js?v=1";

const STATUTS = { brouillon: 'Brouillon', envoye: 'Envoyé', accepte: 'Accepté', refuse: 'Refusé' };
const NOMS_MARQUES = { ajax: 'Ajax', somfy: 'Somfy', yale: 'Yale Home' };

const $ = (id) => document.getElementById(id);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Format monétaire "1 234,56 €" avec des espaces simples (compatibles PDF)
function eur(n) {
    const neg = n < 0; const v = Math.abs(r2(n));
    const [ent, dec] = v.toFixed(2).split('.');
    return (neg ? '-' : '') + ent.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + dec + ' €';
}
function num(n) { return String(r2(n)).replace('.', ','); }
function isoJour(d = new Date()) {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
}
function ajouterJours(iso, j) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + j); return isoJour(d); }
function dateFr(iso) { if (!iso) return '—'; const [y, m, d] = String(iso).split('-'); return d && m && y ? `${d}/${m}/${y}` : String(iso); }
function tsToMs(t) { if (!t) return 0; if (typeof t.toMillis === 'function') return t.toMillis(); if (t.seconds) return t.seconds * 1000; const x = new Date(t).getTime(); return isNaN(x) ? 0 : x; }

function texteSansHtml(s) {
    return String(s || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'");
}
function titreApresComposition(ligne) {
    const low = ligne.toLowerCase().replace(/\s+/g, ' ').trim();
    return low.includes('points forts')
        || low.includes('caractéristiques')
        || low.includes('caracteristiques')
        || low.startsWith('fiche officielle')
        || low.startsWith('spécifications')
        || low.startsWith('specifications');
}
function contenuDepuisDescription(html) {
    const lignes = texteSansHtml(html).split('\n').map((l) => l.trim()).filter(Boolean);
    let dans = false;
    const items = [];
    lignes.forEach((ligne) => {
        if (!dans) {
            if (ligne.toLowerCase().includes('composition du kit')) dans = true;
            return;
        }
        if (titreApresComposition(ligne)) { dans = false; return; }
        if (!dans) return;
        const coupure = ligne.indexOf(' : ');
        const nom = (coupure >= 0 ? ligne.slice(0, coupure) : ligne).trim();
        if (nom) items.push(nom);
    });
    return items;
}
/** Noms du pack : contenu_pack s'il est rempli, sinon la section « Composition du kit ». */
export function contenuPack(produit) {
    if (!produit) return [];
    if (Array.isArray(produit.contenu_pack)) {
        const lignes = produit.contenu_pack.map((s) => String(s || '').trim()).filter(Boolean);
        if (lignes.length) return lignes;
    }
    return contenuDepuisDescription(produit.description_longue);
}
function urlImageSure(url) {
    const s = String(url || '').trim();
    if (!s || /^(javascript|data|vbscript):/i.test(s)) return '';
    return s;
}
function colonneDescriptif(arr) {
    return (Array.isArray(arr) ? arr : []).map((item) => {
        if (Array.isArray(item)) return { label: String(item[0] || ''), texte: String(item[1] || '') };
        if (!item || typeof item !== 'object') return null;
        return { label: String(item.label || item.l || ''), texte: String(item.texte || item.t || '') };
    }).filter((x) => x && (x.label || x.texte));
}
function descriptifFirestore(desc) {
    if (!desc || typeof desc !== 'object') return null;
    return {
        titre: String(desc.titre || ''),
        gauche: colonneDescriptif(desc.gauche),
        droite: colonneDescriptif(desc.droite)
    };
}

// ---------- Calculs ----------
export function calculerTotaux(dv) {
    const lignes = (dv.lignes || []).map((l) => ({ ...l, total_ht: r2((Number(l.quantite) || 0) * (Number(l.pu_ht) || 0)) }));
    const ht_brut = r2(lignes.reduce((s, l) => s + l.total_ht, 0));
    const rv = Math.max(0, Number(dv.remise_valeur) || 0);
    const remise = r2(dv.remise_type === '€' ? Math.min(rv, ht_brut) : ht_brut * Math.min(rv, 100) / 100);
    const ht = r2(ht_brut - remise);
    const taux = dv.tva_franchise ? 0 : (Number(dv.tva_taux) || 0);
    const tva = r2(ht * taux / 100);
    const ttc = r2(ht + tva);
    const acompte = r2(ttc * Math.min(Math.max(Number(dv.acompte_pct) || 0, 0), 100) / 100);
    return { lignes, totaux: { ht_brut, remise, ht, tva, ttc, acompte, taux } };
}

export function initDevis({ db, toast, getProduits, ouvrirOnglet, getContact, profilIncomplet, ouvrirProfil, getClients, creerClient }) {
    let devisData = {};        // id -> devis
    let courant = null;        // devis en cours d'édition
    let idCourant = null;
    let modifie = false;

    // ---------- Liste ----------
    async function chargerDevis() {
        const tbody = $('tbody-devis');
        try {
            const snap = await getDocs(collection(db, "devis"));
            devisData = {};
            snap.forEach((d) => { devisData[d.id] = d.data(); });
            afficherListe();
        } catch (e) {
            console.error(e);
            const refus = e && e.code === 'permission-denied';
            tbody.innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--red)">${refus
                ? "Accès refusé par les règles Firestore : ajoutez la collection « devis » dans vos règles (voir firestore.rules) et vérifiez que vous êtes connecté avec le compte administrateur."
                : "Erreur de chargement des devis."}</td></tr>`;
        }
    }

    function afficherListe() {
        const tbody = $('tbody-devis');
        const q = $('devis-search').value.toLowerCase().trim();
        const st = $('devis-filter-statut').value;
        const ids = Object.keys(devisData).sort((a, b) => String(devisData[b].numero || '').localeCompare(String(devisData[a].numero || '')) || tsToMs(devisData[b].date_creation) - tsToMs(devisData[a].date_creation));
        $('devis-count').textContent = ids.length;
        $('tab-count-devis').textContent = ids.length;

        // Indicateurs
        const tot = (f) => ids.filter((id) => f(devisData[id])).reduce((s, id) => s + (Number(devisData[id].totaux?.ttc) || 0), 0);
        const nb = (s) => ids.filter((id) => (devisData[id].statut || 'brouillon') === s).length;
        $('devis-kpis').innerHTML = ids.length ? `
            <div class="kpi"><small>En attente de réponse</small><b>${nb('envoye')}</b><span>${eur(tot((d) => d.statut === 'envoye'))} TTC</span></div>
            <div class="kpi ok"><small>Acceptés</small><b>${nb('accepte')}</b><span>${eur(tot((d) => d.statut === 'accepte'))} TTC${nb('accepte') + nb('refuse') ? ' · ' + Math.round(nb('accepte') / (nb('accepte') + nb('refuse')) * 100) + ' % de réussite' : ''}</span></div>
            <div class="kpi"><small>Brouillons</small><b>${nb('brouillon')}</b><span>à finaliser</span></div>
            <div class="kpi ko"><small>Refusés</small><b>${nb('refuse')}</b><span>${eur(tot((d) => d.statut === 'refuse'))} TTC</span></div>` : '';

        if (!ids.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty">Aucun devis pour le moment. Cliquez sur « Nouveau devis » ou sur « Créer un devis » depuis une demande client.</td></tr>`;
            return;
        }
        const liste = ids.filter((id) => {
            const d = devisData[id];
            const txt = [d.numero, d.objet, d.client?.nom, d.client?.prenom, d.client?.societe, d.client?.contact].join(' ').toLowerCase();
            return (st === 'all' || (d.statut || 'brouillon') === st) && (!q || txt.includes(q));
        });
        if (!liste.length) { tbody.innerHTML = `<tr><td colspan="6" class="empty">Aucun devis ne correspond à votre recherche.</td></tr>`; return; }
        tbody.innerHTML = liste.map((id) => {
            const d = devisData[id];
            const statut = d.statut || 'brouillon';
            const client = [d.client?.societe, [d.client?.nom, d.client?.prenom].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || '—';
            return `<tr>
                <td><strong class="mono">${esc(d.numero || '—')}</strong>${d.objet ? `<div class="sub">${esc(d.objet)}</div>` : ''}</td>
                <td>${esc(client)}</td>
                <td style="white-space:nowrap">${esc(dateFr(d.date_emission))}</td>
                <td style="white-space:nowrap;font-weight:800">${esc(eur(d.totaux?.ttc || 0))}</td>
                <td><span class="statut-pill s-${esc(statut)}">${esc(STATUTS[statut] || statut)}</span></td>
                <td style="white-space:nowrap">
                    <button class="btn-sm-edit" data-dv="open" data-id="${esc(id)}"><svg class="i"><use href="#i-edit"/></svg>Ouvrir</button>
                    <button class="btn-sm" data-dv="pdf" data-id="${esc(id)}" title="Télécharger le PDF"><svg class="i"><use href="#i-download"/></svg></button>
                    <button class="btn-sm" data-dv="dup" data-id="${esc(id)}" title="Dupliquer"><svg class="i"><use href="#i-copy"/></svg></button>
                    <button class="btn-sm-del" data-dv="del" data-id="${esc(id)}" title="Supprimer"><svg class="i"><use href="#i-trash"/></svg></button>
                </td></tr>`;
        }).join('');
    }
    $('devis-search').addEventListener('input', afficherListe);
    $('devis-filter-statut').addEventListener('change', afficherListe);
    $('tbody-devis').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-dv]'); if (!b) return;
        const id = b.dataset.id, d = devisData[id]; if (!d) return;
        if (b.dataset.dv === 'open') ouvrirEditeur(structuredClone(d), id);
        if (b.dataset.dv === 'pdf') genererPDF(d);
        if (b.dataset.dv === 'dup') dupliquer(d);
        if (b.dataset.dv === 'del') {
            if (!confirm(`Supprimer définitivement le devis ${d.numero || ''} ?`)) return;
            try { await deleteDoc(doc(db, "devis", id)); delete devisData[id]; afficherListe(); toast('Devis supprimé'); }
            catch (err) { toast('Erreur : ' + err.message, 'err'); }
        }
    });

    // ---------- Numérotation automatique : DEV-AAAA-0001 ----------
    function prochainNumero() {
        const an = new Date().getFullYear();
        let max = 0;
        Object.values(devisData).forEach((d) => {
            const m = /^DEV-(\d{4})-(\d+)$/.exec(String(d.numero || ''));
            if (m && +m[1] === an) max = Math.max(max, +m[2]);
        });
        return `DEV-${an}-${String(max + 1).padStart(4, '0')}`;
    }

    function nouveauDevis(prefill = {}) {
        const auj = isoJour();
        const base = {
            numero: prochainNumero(),
            date_emission: auj,
            date_validite: ajouterJours(auj, Number(ENTREPRISE.validite_jours) || 30),
            statut: 'brouillon',
            objet: '',
            client: { nom: '', prenom: '', societe: '', contact: '', adresse: '' },
            demande_id: null,
            lignes: [],
            remise_type: '%', remise_valeur: 0,
            tva_taux: Number(ENTREPRISE.tva_defaut ?? 20), tva_franchise: !!ENTREPRISE.tva_franchise_defaut,
            acompte_pct: Number(ENTREPRISE.acompte_defaut ?? 30),
            notes: '', conditions: ENTREPRISE.conditions_defaut || '',
            contact: typeof getContact === 'function' ? getContact() : null
        };
        const devis = { ...base, ...prefill };
        if (!devis.contact) devis.contact = typeof getContact === 'function' ? getContact() : null;
        return devis;
    }
    function contactAffiche(d) {
        const c = d && d.contact;
        if (c && typeof c === 'object' && (c.nom || c.telephone || c.email)) {
            return {
                nom: String(c.nom || '').trim(),
                telephone: String(c.telephone || '').trim(),
                email: String(c.email || '').trim(),
                uid: c.uid || ''
            };
        }
        return typeof getContact === 'function' ? getContact() : { nom: '', telephone: '', email: '', uid: '' };
    }
    function majBlocContact() {
        const bandeau = $('dv-contact-banner');
        const texte = $('dv-contact-texte');
        if (bandeau) bandeau.hidden = !(typeof profilIncomplet === 'function' && profilIncomplet());
        if (!texte) return;
        const c = contactAffiche(courant || {});
        const lignes = [c.nom, c.telephone, c.email].filter(Boolean);
        texte.textContent = lignes.length ? lignes.join(' · ') : 'Aucun contact à afficher.';
    }

    // ---------- Éditeur ----------
    function ouvrirEditeur(dv, id = null) {
        courant = dv; idCourant = id; modifie = false;
        ouvrirOnglet('panel-devis');
        $('devis-liste-box').hidden = true;
        $('devis-editeur').hidden = false;
        remplirFormulaire();
        majBlocContact();
        window.scrollTo({ top: $('panel-devis').offsetTop - 90, behavior: 'smooth' });
    }
    function fermerEditeur(force = false) {
        if (!force && modifie && !confirm('Des modifications ne sont pas enregistrées. Quitter quand même ?')) return;
        courant = null; idCourant = null; modifie = false;
        $('devis-editeur').hidden = true;
        $('devis-liste-box').hidden = false;
    }
    $('btn-devis-retour').addEventListener('click', () => fermerEditeur());
    $('btn-nouveau-devis').addEventListener('click', () => ouvrirEditeur(nouveauDevis()));

    function libelleClient(c) {
        const qui = [c.prenom, c.nom].filter(Boolean).join(' ') || c.societe || 'Client';
        const detail = [c.societe && c.nom ? c.societe : '', c.email, c.telephone].filter(Boolean).join(' · ');
        return { qui, detail };
    }
    function appliquerClient(c) {
        if (!courant) return;
        const email = String(c.email || '').trim();
        const telephone = String(c.telephone || '').trim();
        courant.client_id = c.id;
        courant.client = {
            ...(courant.client || {}),
            nom: c.nom || '',
            prenom: c.prenom || '',
            societe: c.societe || '',
            email,
            telephone,
            contact: [email, telephone].filter(Boolean).join(' · '),
            adresse: (courant.client && courant.client.adresse) || ''
        };
        remplirFormulaire();
        modifie = true;
    }
    function rendreRechercheClients() {
        const q = $('dv-client-recherche').value.toLowerCase().trim();
        const box = $('dv-client-resultats');
        const tous = typeof getClients === 'function' ? getClients() : [];
        if (!q) { box.hidden = true; box.innerHTML = ''; return; }
        const liste = tous.filter((c) => [c.nom, c.prenom, c.societe, c.email, c.telephone].join(' ').toLowerCase().includes(q)).slice(0, 8);
        box.hidden = false;
        box.innerHTML = liste.length ? liste.map((c) => {
            const l = libelleClient(c);
            return `<button type="button" data-choisir-client="${esc(c.id)}"><b>${esc(l.qui)}</b><small>${esc(l.detail)}</small></button>`;
        }).join('') : '<div class="empty">Aucun client correspondant.</div>';
    }
    $('dv-client-recherche').addEventListener('input', rendreRechercheClients);
    $('dv-client-resultats').addEventListener('click', (e) => {
        const b = e.target.closest('[data-choisir-client]'); if (!b) return;
        const c = (getClients() || []).find((x) => x.id === b.dataset.choisirClient);
        if (!c) return;
        appliquerClient(c);
        $('dv-client-recherche').value = '';
        $('dv-client-resultats').hidden = true;
        toast(`${libelleClient(c).qui} sélectionné`);
    });
    $('btn-nouveau-client-devis').addEventListener('click', () => {
        $('dv-nouveau-client').hidden = false;
        $('dv-nouveau-client-msg').textContent = '';
        $('dv-nc-nom').focus();
    });
    $('btn-annuler-client-devis').addEventListener('click', () => { $('dv-nouveau-client').hidden = true; });
    $('btn-creer-client-devis').addEventListener('click', async () => {
        const msg = $('dv-nouveau-client-msg');
        const fiche = {
            nom: $('dv-nc-nom').value.trim(),
            prenom: $('dv-nc-prenom').value.trim(),
            societe: $('dv-nc-societe').value.trim(),
            email: $('dv-nc-email').value.trim(),
            telephone: $('dv-nc-telephone').value.trim()
        };
        const res = await creerClient(fiche);
        if (!res) return;
        if (res.doublon) {
            appliquerClient(res.doublon);
            msg.textContent = 'Ce client existe déjà. Il a été sélectionné.';
            $('dv-nouveau-client').hidden = true;
            return;
        }
        if (res.client) {
            appliquerClient(res.client);
            ['dv-nc-nom', 'dv-nc-prenom', 'dv-nc-societe', 'dv-nc-email', 'dv-nc-telephone'].forEach((id) => { $(id).value = ''; });
            $('dv-nouveau-client').hidden = true;
        }
    });

    function remplirFormulaire() {
        const d = courant;
        $('dv-titre').textContent = idCourant ? `Devis ${d.numero}` : 'Nouveau devis';
        $('dv-numero').value = d.numero || '';
        $('dv-date').value = d.date_emission || '';
        $('dv-validite').value = d.date_validite || '';
        $('dv-statut').value = d.statut || 'brouillon';
        $('dv-objet').value = d.objet || '';
        $('dv-client-nom').value = d.client?.nom || '';
        $('dv-client-prenom').value = d.client?.prenom || '';
        $('dv-client-societe').value = d.client?.societe || '';
        $('dv-client-contact').value = d.client?.contact || '';
        $('dv-client-adresse').value = d.client?.adresse || '';
        $('dv-client-recherche').value = '';
        $('dv-client-resultats').hidden = true;
        $('dv-nouveau-client').hidden = true;
        const lie = $('dv-client-lie');
        if (d.client_id) {
            lie.hidden = false;
            lie.textContent = 'Fiche client liée. Les coordonnées ci-dessous restent celles de ce devis.';
        } else lie.hidden = true;
        $('dv-demande-lien').hidden = !d.demande_id;
        $('dv-tva').value = d.tva_franchise ? 'franchise' : String(d.tva_taux ?? 20);
        $('dv-remise').value = d.remise_valeur ?? 0;
        $('dv-remise-type').value = d.remise_type || '%';
        $('dv-acompte').value = d.acompte_pct ?? 0;
        $('dv-notes').value = d.notes || '';
        $('dv-conditions').value = d.conditions || '';
        majStatutPill();
        rendreLignes();
    }

    function lireFormulaire() {
        const d = courant;
        d.numero = $('dv-numero').value.trim();
        d.date_emission = $('dv-date').value;
        d.date_validite = $('dv-validite').value;
        d.statut = $('dv-statut').value;
        d.objet = $('dv-objet').value.trim();
        d.client = {
            nom: $('dv-client-nom').value.trim(), prenom: $('dv-client-prenom').value.trim(),
            societe: $('dv-client-societe').value.trim(), contact: $('dv-client-contact').value.trim(),
            adresse: $('dv-client-adresse').value.trim(),
            email: d.client?.email || '',
            telephone: d.client?.telephone || ''
        };
        const tva = $('dv-tva').value;
        d.tva_franchise = tva === 'franchise';
        d.tva_taux = d.tva_franchise ? 0 : parseFloat(tva);
        d.remise_valeur = Math.max(0, parseFloat($('dv-remise').value) || 0);
        d.remise_type = $('dv-remise-type').value;
        d.acompte_pct = Math.min(100, Math.max(0, parseFloat($('dv-acompte').value) || 0));
        d.notes = $('dv-notes').value.trim();
        d.conditions = $('dv-conditions').value.trim();
        d.contact = (courant && courant.contact) ? courant.contact : (typeof getContact === 'function' ? getContact() : null);
        return d;
    }

    function majStatutPill() {
        const s = $('dv-statut').value;
        const p = $('dv-statut-pill');
        p.className = 'statut-pill s-' + s; p.textContent = STATUTS[s];
    }
    $('dv-statut').addEventListener('change', majStatutPill);

    function tauxCourant() { const v = $('dv-tva').value; return v === 'franchise' ? 0 : parseFloat(v) || 0; }
    function ttcVersHt(prixTtc) { return r2((Number(prixTtc) || 0) / (1 + tauxCourant() / 100)); }

    function contenuLigne(l) {
        if (Array.isArray(l.contenu)) return l.contenu.map((s) => String(s || '').trim()).filter(Boolean);
        if (!l.produit_id) return [];
        const p = getProduits()[l.produit_id];
        if (!p || !p.est_pack) return [];
        return contenuPack(p);
    }
    function imageLigne(l) {
        if (l.image) return urlImageSure(l.image);
        if (!l.produit_id) return '';
        const p = getProduits()[l.produit_id];
        return p ? urlImageSure(p.image) : '';
    }
    function srcVignette(url) {
        const s = urlImageSure(url);
        if (!s) return '';
        const local = window.imageProduit ? window.imageProduit(s) : s;
        if (!local || local === window.IMAGE_PRODUIT_PLACEHOLDER) return '';
        return local;
    }

    function rendreLignes() {
        const tb = $('dv-lignes');
        if (!courant.lignes.length) {
            tb.innerHTML = `<tr><td colspan="5" class="empty">Ajoutez des équipements du catalogue ou des lignes libres (installation, main d'œuvre...).</td></tr>`;
        } else {
            tb.innerHTML = courant.lignes.map((l, i) => {
                const contenu = contenuLigne(l);
                const src = srcVignette(imageLigne(l));
                const liste = contenu.length
                    ? `<div class="l-contenu"><span>Contenu du pack :</span><ul>${contenu.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>`
                    : '';
                return `<tr data-i="${i}">
                    <td>
                        <div class="l-row">
                            ${src ? `<img class="l-thumb" src="${esc(src)}" alt="" onerror="this.remove()">` : ''}
                            <div class="l-main">
                                <input type="text" class="l-des" data-k="designation" value="${esc(l.designation)}" placeholder="Désignation">
                                <input type="text" class="l-desc" data-k="description" value="${esc(l.description || '')}" placeholder="Détail (facultatif)">
                                ${liste}
                                ${l.produit_id ? `<span class="l-tag">Catalogue · ${esc(NOMS_MARQUES[l.marque] || l.marque || '')}${l.prix_catalogue_ttc ? ' · ' + esc(eur(l.prix_catalogue_ttc)) + ' TTC' : ''}</span>` : ''}
                            </div>
                        </div>
                    </td>
                    <td data-label="Quantité"><div class="qte"><input type="number" data-k="quantite" min="0" step="0.5" value="${esc(l.quantite)}">${l.unite ? `<span>${esc(l.unite)}</span>` : ''}</div></td>
                    <td data-label="PU HT (€)"><input type="number" data-k="pu_ht" min="0" step="0.01" value="${esc(l.pu_ht)}"></td>
                    <td class="l-total" data-label="Total HT">${esc(eur(r2((Number(l.quantite) || 0) * (Number(l.pu_ht) || 0))))}</td>
                    <td class="l-act">
                        <button type="button" class="btn-sm" data-l="up" title="Monter" ${i === 0 ? 'disabled' : ''}>↑</button>
                        <button type="button" class="btn-sm-del" data-l="del" title="Retirer la ligne"><svg class="i"><use href="#i-trash"/></svg></button>
                    </td>
                </tr>`;
            }).join('');
        }
        majTotaux();
    }

    function majTotaux() {
        if (!courant) return;
        lireFormulaire();
        const { lignes, totaux } = calculerTotaux(courant);
        document.querySelectorAll('#dv-lignes tr[data-i]').forEach((tr) => {
            const l = lignes[+tr.dataset.i]; if (l) tr.querySelector('.l-total').textContent = eur(l.total_ht);
        });
        const t = totaux;
        $('dv-totaux').innerHTML = `
            <div><dt>Total HT</dt><dd>${eur(t.ht_brut)}</dd></div>
            ${t.remise ? `<div class="neg"><dt>Remise${courant.remise_type === '%' ? ' ' + num(courant.remise_valeur) + ' %' : ''}</dt><dd>- ${eur(t.remise)}</dd></div>
            <div><dt>Total HT après remise</dt><dd>${eur(t.ht)}</dd></div>` : ''}
            <div><dt>${courant.tva_franchise ? 'TVA non applicable' : 'TVA ' + num(t.taux) + ' %'}</dt><dd>${eur(t.tva)}</dd></div>
            <div class="grand"><dt>Total TTC</dt><dd>${eur(t.ttc)}</dd></div>
            ${t.acompte ? `<div class="acompte"><dt>Acompte ${num(courant.acompte_pct)} %</dt><dd>${eur(t.acompte)}</dd></div>` : ''}`;
        $('dv-lignes-hint').textContent = courant.tva_franchise
            ? "TVA non applicable : les prix du catalogue sont repris tels quels."
            : "Les prix du catalogue sont TTC : ils sont convertis automatiquement en HT selon le taux de TVA choisi.";
    }

    $('form-devis').addEventListener('input', (e) => {
        if (!courant) return;
        modifie = true;
        const tr = e.target.closest('tr[data-i]');
        if (tr && e.target.dataset.k) {
            const l = courant.lignes[+tr.dataset.i];
            const k = e.target.dataset.k;
            l[k] = (k === 'quantite' || k === 'pu_ht') ? (parseFloat(e.target.value) || 0) : e.target.value;
            if (k === 'pu_ht') l.pu_manuel = true;
        }
        majTotaux();
    });
    // Changement de TVA : on recalcule le HT des produits du catalogue (sauf prix modifié à la main)
    $('dv-tva').addEventListener('change', () => {
        if (!courant) return;
        courant.lignes.forEach((l) => { if (l.prix_catalogue_ttc && !l.pu_manuel) l.pu_ht = ttcVersHt(l.prix_catalogue_ttc); });
        rendreLignes();
    });
    $('dv-lignes').addEventListener('click', (e) => {
        const b = e.target.closest('[data-l]'); if (!b) return;
        const i = +b.closest('tr').dataset.i;
        if (b.dataset.l === 'del') courant.lignes.splice(i, 1);
        if (b.dataset.l === 'up' && i > 0) [courant.lignes[i - 1], courant.lignes[i]] = [courant.lignes[i], courant.lignes[i - 1]];
        modifie = true; rendreLignes();
    });

    // Lignes libres
    const menu = $('menu-ligne-libre');
    $('btn-ligne-libre').addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('open'); });
    document.addEventListener('click', () => menu.classList.remove('open'));
    menu.addEventListener('click', (e) => {
        const b = e.target.closest('[data-preset]'); if (!b) return;
        courant.lignes.push({ type: 'libre', designation: b.dataset.preset, description: '', quantite: 1, unite: b.dataset.unite || '', pu_ht: 0 });
        modifie = true; rendreLignes();
        const inputs = document.querySelectorAll('#dv-lignes tr:last-child input[data-k="pu_ht"]');
        if (inputs[0]) inputs[0].focus();
    });

    // Sélecteur catalogue
    const picker = $('picker');
    const ORDRE_MARQUES = ['ajax', 'somfy', 'yale'];
    let marquePicker = '';
    function ouvrirPicker() {
        if (!courant) return;
        picker.hidden = false;
        const marques = marquesCatalogue();
        if (!marques.includes(marquePicker)) marquePicker = marques[0] || '';
        $('picker-search').value = '';
        rendrePicker();
        setTimeout(() => $('picker-search').focus(), 50);
    }
    function fermerPicker() { picker.hidden = true; }
    $('btn-ligne-catalogue').addEventListener('click', ouvrirPicker);
    $('picker-close').addEventListener('click', fermerPicker);
    picker.addEventListener('click', (e) => { if (e.target === picker) fermerPicker(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !picker.hidden) fermerPicker(); });
    $('picker-search').addEventListener('input', rendrePicker);
    $('picker-cat').addEventListener('change', rendrePicker);
    function nomMarque(m) { return NOMS_MARQUES[m] || (m ? m.charAt(0).toUpperCase() + m.slice(1) : 'Autre'); }
    function marquesCatalogue() {
        const presentes = new Set(Object.values(getProduits()).map((p) => p.marque).filter(Boolean));
        const connues = ORDRE_MARQUES.filter((m) => presentes.has(m));
        const autres = [...presentes].filter((m) => !ORDRE_MARQUES.includes(m)).sort((a, b) => nomMarque(a).localeCompare(nomMarque(b), 'fr'));
        return [...connues, ...autres];
    }
    function ajouterProduitDevis(id) {
        const p = getProduits()[id];
        if (!p || !courant) return;
        const existante = courant.lignes.find((l) => l.produit_id === id);
        if (existante) {
            existante.quantite = (Number(existante.quantite) || 0) + 1;
            if (!Array.isArray(existante.contenu)) existante.contenu = p.est_pack ? contenuPack(p) : [];
            if (!existante.image) existante.image = urlImageSure(p.image);
        } else {
            const ttc = parseFloat(p.prix);
            courant.lignes.push({
                type: 'produit', produit_id: id, marque: p.marque || '',
                designation: p.nom || '', description: [NOMS_MARQUES[p.marque], p.categorie].filter(Boolean).join(' · '),
                quantite: 1, unite: '', prix_catalogue_ttc: isFinite(ttc) ? ttc : 0, pu_ht: isFinite(ttc) ? ttcVersHt(ttc) : 0,
                image: urlImageSure(p.image),
                contenu: p.est_pack ? contenuPack(p) : []
            });
        }
        modifie = true;
        rendreLignes();
        toast(`${p.nom} ajouté au devis`);
    }
    function rendrePicker() {
        const prods = getProduits();
        const marques = marquesCatalogue();
        $('picker-brands').innerHTML = marques.map((m) =>
            `<button type="button" class="picker-brand${m === marquePicker ? ' active' : ''}" data-marque="${esc(m)}">${esc(nomMarque(m))}</button>`
        ).join('') || '<span class="hint">Aucune marque dans le catalogue.</span>';
        const q = $('picker-search').value.toLowerCase().trim();
        const catChoisie = $('picker-cat').value;
        const deLaMarque = Object.entries(prods).filter(([, p]) => p.marque === marquePicker);
        const cats = [...new Set(deLaMarque.map(([, p]) => p.categorie).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
        const catGardee = cats.includes(catChoisie) ? catChoisie : 'all';
        $('picker-cat').innerHTML = '<option value="all">Toutes les catégories</option>' + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
        $('picker-cat').value = catGardee;
        const ids = deLaMarque.filter(([, p]) => {
            if (catGardee !== 'all' && p.categorie !== catGardee) return false;
            if (!q) return true;
            return [p.nom, p.categorie, p.description].join(' ').toLowerCase().includes(q);
        }).map(([id]) => id).sort((a, b) => String(prods[a].nom).localeCompare(String(prods[b].nom), 'fr'));
        if (!ids.length) {
            $('picker-list').innerHTML = '<div class="empty">Aucun produit pour cette marque.</div>';
            return;
        }
        const groupes = new Map();
        ids.forEach((id) => {
            const cle = prods[id].categorie || 'Sans catégorie';
            if (!groupes.has(cle)) groupes.set(cle, []);
            groupes.get(cle).push(id);
        });
        const cles = [...groupes.keys()].sort((a, b) => a.localeCompare(b, 'fr'));
        $('picker-list').innerHTML = cles.map((cle) => `
            <section class="picker-group">
                <h4>${esc(cle)}</h4>
                <div class="picker-cards">${groupes.get(cle).map((id) => cartePicker(id, prods[id])).join('')}</div>
            </section>`).join('');
    }
    function cartePicker(id, p) {
        const src = srcVignette(p.image) || 'assets/img/logo-mark.png';
        const prix = parseFloat(p.prix);
        return `<button type="button" class="picker-card" data-pid="${esc(id)}">
            <img src="${esc(src)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='assets/img/logo-mark.png'">
            <span class="picker-body">
                <b>${esc(p.nom)}</b>
                <small>${p.est_pack ? '<span class="badge">PACK</span> ' : ''}${esc(p.categorie || '')}</small>
                <em>${isFinite(prix) && prix > 0 ? esc(eur(prix)) + ' TTC' : 'Sur devis'}</em>
            </span>
        </button>`;
    }
    $('picker-brands').addEventListener('click', (e) => {
        const b = e.target.closest('[data-marque]'); if (!b) return;
        marquePicker = b.dataset.marque;
        $('picker-cat').value = 'all';
        rendrePicker();
    });
    $('picker-list').addEventListener('click', (e) => {
        const b = e.target.closest('[data-pid]'); if (!b) return;
        ajouterProduitDevis(b.dataset.pid);
        b.classList.add('added');
        setTimeout(() => b.classList.remove('added'), 700);
    });

    // ---------- Enregistrement ----------
    function validerDevis(d) {
        if (!d.numero) return 'Indiquez un numéro de devis.';
        if (!d.client.nom && !d.client.societe) return 'Indiquez au moins le nom du client (ou la société).';
        if (!d.date_emission || !d.date_validite) return 'Indiquez les dates du devis.';
        const doublon = Object.keys(devisData).find((id) => id !== idCourant && devisData[id].numero === d.numero);
        if (doublon) return `Le numéro ${d.numero} est déjà utilisé par un autre devis.`;
        return null;
    }
    function versFirestore(d) {
        const { lignes, totaux } = calculerTotaux(d);
        return {
            numero: d.numero, date_emission: d.date_emission, date_validite: d.date_validite,
            statut: d.statut, objet: d.objet || '',
            client: d.client, client_id: d.client_id || null, demande_id: d.demande_id || null,
            lignes: lignes.map((l) => ({
                type: l.type || 'libre', produit_id: l.produit_id || null, marque: l.marque || '',
                designation: String(l.designation || ''), description: String(l.description || ''),
                quantite: Number(l.quantite) || 0, unite: l.unite || '', pu_ht: r2(l.pu_ht),
                prix_catalogue_ttc: l.prix_catalogue_ttc ?? null, pu_manuel: !!l.pu_manuel, total_ht: l.total_ht,
                contenu: contenuLigne(l),
                image: imageLigne(l),
                ...(l.repere ? { repere: String(l.repere) } : {}),
                ...(l.tva_taux == null || l.tva_taux === '' ? {} : { tva_taux: Number(l.tva_taux) }),
                ...(l.descriptif ? { descriptif: descriptifFirestore(l.descriptif) } : {})
            })),
            remise_type: d.remise_type, remise_valeur: Number(d.remise_valeur) || 0,
            tva_taux: Number(d.tva_taux) || 0, tva_franchise: !!d.tva_franchise,
            acompte_pct: Number(d.acompte_pct) || 0,
            notes: d.notes || '', conditions: d.conditions || '',
            contact: d.contact && typeof d.contact === 'object' ? {
                nom: String(d.contact.nom || ''),
                telephone: String(d.contact.telephone || ''),
                email: String(d.contact.email || ''),
                uid: String(d.contact.uid || '')
            } : null,
            totaux: { ht_brut: totaux.ht_brut, remise: totaux.remise, ht: totaux.ht, tva: totaux.tva, ttc: totaux.ttc, acompte: totaux.acompte },
            date_maj: new Date()
        };
    }
    async function enregistrer() {
        const d = lireFormulaire();
        const err = validerDevis(d);
        if (err) { toast(err, 'err'); return false; }
        const btn = $('btn-devis-save'); btn.disabled = true;
        try {
            const data = versFirestore(d);
            if (idCourant) {
                await updateDoc(doc(db, "devis", idCourant), data);
                devisData[idCourant] = { ...devisData[idCourant], ...data };
            } else {
                data.date_creation = new Date();
                const ref = await addDoc(collection(db, "devis"), data);
                idCourant = ref.id; devisData[ref.id] = data;
            }
            courant = structuredClone(devisData[idCourant]);
            $('dv-titre').textContent = `Devis ${d.numero}`;
            modifie = false; afficherListe();
            toast(`Devis ${d.numero} enregistré`);
            return true;
        } catch (e) {
            console.error(e);
            toast(e && e.code === 'permission-denied' ? "Accès refusé : publiez les règles Firestore incluant la collection « devis »." : 'Erreur : ' + e.message, 'err');
            return false;
        } finally { btn.disabled = false; }
    }
    $('btn-devis-save').addEventListener('click', enregistrer);
    $('form-devis').addEventListener('submit', (e) => { e.preventDefault(); enregistrer(); });
    $('btn-devis-pdf').addEventListener('click', async () => {
        const d = lireFormulaire();
        if (!d.client.nom && !d.client.societe) { toast('Indiquez au moins le nom du client avant de générer le PDF.', 'err'); return; }
        const btn = $('btn-devis-pdf');
        btn.disabled = true;
        try { await genererPDF(d); }
        finally { btn.disabled = false; }
    });
    $('btn-devis-dupliquer').addEventListener('click', () => dupliquer(lireFormulaire()));

    function dupliquer(d) {
        if (modifie && courant && !confirm('Des modifications ne sont pas enregistrées. Dupliquer quand même ?')) return;
        const copie = structuredClone({ ...d });
        delete copie.date_creation; delete copie.date_maj; delete copie.totaux;
        const neuf = nouveauDevis({ ...copie, numero: undefined, date_emission: undefined, date_validite: undefined, statut: 'brouillon' });
        const base = nouveauDevis();
        neuf.numero = base.numero; neuf.date_emission = base.date_emission; neuf.date_validite = base.date_validite;
        modifie = false;
        ouvrirEditeur(neuf, null);
        modifie = true;
        toast('Copie créée : pensez à enregistrer.');
    }

    // ---------- Depuis une demande client ----------
    function creerDepuisDemande(dem) {
        if (courant && modifie && !confirm('Un devis est en cours de modification. Le remplacer ?')) return;
        const contact = String(dem.contact || '');
        ouvrirEditeur(nouveauDevis({
            objet: dem.raison || '',
            client: { nom: dem.nom || '', prenom: dem.prenom || '', societe: '', contact, adresse: '' },
            demande_id: dem.id || null,
            notes: dem.message ? `Suite à votre demande : « ${String(dem.message).slice(0, 400)} »` : ''
        }));
        modifie = true;
    }

    // ---------- PDF ----------
    async function genererPDF(d) {
        const lignes = (d.lignes || []).map((l) => ({
            ...l,
            contenu: contenuLigne(l),
            image: srcVignette(imageLigne(l))
        }));
        try {
            toast('Préparation du PDF…');
            const { nom } = await genererDevisPdf({ ...d, lignes, contact: contactAffiche(d) });
            toast('PDF téléchargé : ' + nom);
        } catch (e) {
            console.error(e);
            toast(e && e.message ? e.message : 'Impossible de générer le PDF.', 'err');
        }
    }

    // Avertit si on quitte la page avec un devis non enregistré
    window.addEventListener('beforeunload', (e) => { if (courant && modifie) { e.preventDefault(); e.returnValue = ''; } });

    if ($('dv-aller-profil')) $('dv-aller-profil').addEventListener('click', () => { if (typeof ouvrirProfil === 'function') ouvrirProfil(); });

    return { chargerDevis, creerDepuisDemande, genererPDF, ouvrirEditeur, nouveauDevis, rafraichirContact: majBlocContact };
}
