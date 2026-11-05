// ===================== CARAPACE PORTAIL : DEVIS =====================
// Création, enregistrement (collection Firestore "devis", accès admin uniquement)
// et génération PDF côté navigateur (jsPDF). Aucun envoi d'e-mail depuis le site.
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ENTREPRISE } from "./entreprise-config.js";

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

export function initDevis({ db, toast, getProduits, ouvrirOnglet }) {
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
        return {
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
            ...prefill
        };
    }

    // ---------- Éditeur ----------
    function ouvrirEditeur(dv, id = null) {
        courant = dv; idCourant = id; modifie = false;
        ouvrirOnglet('panel-devis');
        $('devis-liste-box').hidden = true;
        $('devis-editeur').hidden = false;
        remplirFormulaire();
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
            adresse: $('dv-client-adresse').value.trim()
        };
        const tva = $('dv-tva').value;
        d.tva_franchise = tva === 'franchise';
        d.tva_taux = d.tva_franchise ? 0 : parseFloat(tva);
        d.remise_valeur = Math.max(0, parseFloat($('dv-remise').value) || 0);
        d.remise_type = $('dv-remise-type').value;
        d.acompte_pct = Math.min(100, Math.max(0, parseFloat($('dv-acompte').value) || 0));
        d.notes = $('dv-notes').value.trim();
        d.conditions = $('dv-conditions').value.trim();
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

    function rendreLignes() {
        const tb = $('dv-lignes');
        if (!courant.lignes.length) {
            tb.innerHTML = `<tr><td colspan="5" class="empty">Ajoutez des équipements du catalogue ou des lignes libres (installation, main d'œuvre...).</td></tr>`;
        } else {
            tb.innerHTML = courant.lignes.map((l, i) => `
                <tr data-i="${i}">
                    <td>
                        <input type="text" class="l-des" data-k="designation" value="${esc(l.designation)}" placeholder="Désignation">
                        <input type="text" class="l-desc" data-k="description" value="${esc(l.description || '')}" placeholder="Détail (facultatif)">
                        ${l.produit_id ? `<span class="l-tag">Catalogue · ${esc(NOMS_MARQUES[l.marque] || l.marque || '')}${l.prix_catalogue_ttc ? ' · ' + esc(eur(l.prix_catalogue_ttc)) + ' TTC' : ''}</span>` : ''}
                    </td>
                    <td data-label="Quantité"><div class="qte"><input type="number" data-k="quantite" min="0" step="0.5" value="${esc(l.quantite)}">${l.unite ? `<span>${esc(l.unite)}</span>` : ''}</div></td>
                    <td data-label="PU HT (€)"><input type="number" data-k="pu_ht" min="0" step="0.01" value="${esc(l.pu_ht)}"></td>
                    <td class="l-total" data-label="Total HT">${esc(eur(r2((Number(l.quantite) || 0) * (Number(l.pu_ht) || 0))))}</td>
                    <td class="l-act">
                        <button type="button" class="btn-sm" data-l="up" title="Monter" ${i === 0 ? 'disabled' : ''}>↑</button>
                        <button type="button" class="btn-sm-del" data-l="del" title="Retirer la ligne"><svg class="i"><use href="#i-trash"/></svg></button>
                    </td>
                </tr>`).join('');
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
    function ouvrirPicker() { picker.hidden = false; $('picker-search').value = ''; rendrePicker(); setTimeout(() => $('picker-search').focus(), 50); }
    function fermerPicker() { picker.hidden = true; }
    $('btn-ligne-catalogue').addEventListener('click', ouvrirPicker);
    $('picker-close').addEventListener('click', fermerPicker);
    picker.addEventListener('click', (e) => { if (e.target === picker) fermerPicker(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !picker.hidden) fermerPicker(); });
    $('picker-search').addEventListener('input', rendrePicker);
    $('picker-brand').addEventListener('change', rendrePicker);
    function rendrePicker() {
        const prods = getProduits();
        const q = $('picker-search').value.toLowerCase().trim();
        const m = $('picker-brand').value;
        const ids = Object.keys(prods).filter((id) => {
            const p = prods[id];
            return (m === 'all' || p.marque === m) && (!q || [p.nom, p.categorie, p.description].join(' ').toLowerCase().includes(q));
        }).sort((a, b) => String(prods[a].nom).localeCompare(String(prods[b].nom), 'fr'));
        $('picker-list').innerHTML = ids.length ? ids.map((id) => {
            const p = prods[id];
            const brut = /^(javascript|data|vbscript):/i.test(String(p.image || '')) ? '' : (p.image || '');
            const src = window.imageProduit ? window.imageProduit(brut) : brut;
            return `<button type="button" class="picker-item" data-pid="${esc(id)}">
                <img src="${esc(src || 'assets/img/logo-mark.png')}" alt="" loading="lazy" onerror="this.onerror=null;this.src='assets/img/logo-mark.png'">
                <span><b>${esc(p.nom)}</b><small>${esc(NOMS_MARQUES[p.marque] || p.marque || '')}${p.categorie ? ' · ' + esc(p.categorie) : ''}${p.est_pack ? ' · Pack' : ''}</small></span>
                <em>${isFinite(parseFloat(p.prix)) ? esc(eur(parseFloat(p.prix))) + ' TTC' : 'Sur devis'}</em>
                <i class="add"><svg class="i"><use href="#i-plus"/></svg></i></button>`;
        }).join('') : `<div class="empty">Aucun produit trouvé.</div>`;
    }
    $('picker-list').addEventListener('click', (e) => {
        const b = e.target.closest('[data-pid]'); if (!b) return;
        const id = b.dataset.pid, p = getProduits()[id]; if (!p) return;
        const existante = courant.lignes.find((l) => l.produit_id === id);
        if (existante) existante.quantite = (Number(existante.quantite) || 0) + 1;
        else {
            const ttc = parseFloat(p.prix);
            courant.lignes.push({
                type: 'produit', produit_id: id, marque: p.marque || '',
                designation: p.nom || '', description: [NOMS_MARQUES[p.marque], p.categorie].filter(Boolean).join(' · '),
                quantite: 1, unite: '', prix_catalogue_ttc: isFinite(ttc) ? ttc : 0, pu_ht: isFinite(ttc) ? ttcVersHt(ttc) : 0
            });
        }
        modifie = true; rendreLignes();
        b.classList.add('added'); setTimeout(() => b.classList.remove('added'), 700);
        toast(`${p.nom} ajouté au devis`);
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
            client: d.client, demande_id: d.demande_id || null,
            lignes: lignes.map((l) => ({
                type: l.type || 'libre', produit_id: l.produit_id || null, marque: l.marque || '',
                designation: String(l.designation || ''), description: String(l.description || ''),
                quantite: Number(l.quantite) || 0, unite: l.unite || '', pu_ht: r2(l.pu_ht),
                prix_catalogue_ttc: l.prix_catalogue_ttc ?? null, pu_manuel: !!l.pu_manuel, total_ht: l.total_ht
            })),
            remise_type: d.remise_type, remise_valeur: Number(d.remise_valeur) || 0,
            tva_taux: Number(d.tva_taux) || 0, tva_franchise: !!d.tva_franchise,
            acompte_pct: Number(d.acompte_pct) || 0,
            notes: d.notes || '', conditions: d.conditions || '',
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
    $('btn-devis-pdf').addEventListener('click', () => {
        const d = lireFormulaire();
        if (!d.client.nom && !d.client.societe) { toast('Indiquez au moins le nom du client avant de générer le PDF.', 'err'); return; }
        genererPDF(versFirestore(d));
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

    // ---------- Depuis une commande en ligne ----------
    function creerDepuisCommande(cmd) {
        if (courant && modifie && !confirm('Un devis est en cours de modification. Le remplacer ?')) return;
        const c = cmd.client || {};
        const franchise = !!ENTREPRISE.tva_franchise_defaut;
        const taux = franchise ? 0 : Number(ENTREPRISE.tva_defaut ?? 20);
        const versHt = (ttc) => r2((Number(ttc) || 0) / (1 + taux / 100));
        const lignes = (Array.isArray(cmd.articles) ? cmd.articles : []).map((a) => ({
            type: 'produit',
            produit_id: a.id || '',
            marque: '',
            designation: a.nom || '',
            description: '',
            quantite: Number(a.quantite) || 1,
            unite: '',
            prix_catalogue_ttc: Number(a.prix) || 0,
            pu_ht: versHt(a.prix)
        }));
        const adresse = [c.adresse, [c.code_postal, c.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        ouvrirEditeur(nouveauDevis({
            objet: cmd.numero ? `Commande ${cmd.numero}` : 'Commande en ligne',
            client: {
                nom: c.nom || '',
                prenom: c.prenom || '',
                societe: '',
                contact: [c.email, c.telephone].filter(Boolean).join(' · '),
                adresse
            },
            notes: cmd.message ? `Message du client : « ${String(cmd.message).slice(0, 500)} »` : '',
            lignes
        }));
        modifie = true;
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
    function chargerScript(src, integrity) {
        return new Promise((res, rej) => {
            if (document.querySelector(`script[src="${src}"]`)) return res();
            const s = document.createElement('script');
            s.src = src; s.integrity = integrity; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer';
            s.onload = res; s.onerror = () => rej(new Error('Impossible de charger le module PDF (connexion internet ?)'));
            document.head.appendChild(s);
        });
    }
    async function chargerJsPDF() {
        if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable) return window.jspdf.jsPDF;
        await chargerScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk');
        await chargerScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js', 'sha384-fCAW/rDWORTbQXSiB7mOg0QtQ5c+r0f544y6XoKjuVva0nMBlCpNUjiFeG5iMdS3');
        return window.jspdf.jsPDF;
    }
    let logoCache = null;
    function chargerLogo() {
        if (logoCache) return Promise.resolve(logoCache);
        return new Promise((res) => {
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
                const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0);
                logoCache = { data: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight }; res(logoCache);
            };
            img.onerror = () => res(null);
            img.src = 'assets/img/logo-mark.png';
        });
    }
    // Les polices standard du PDF ne connaissent pas certains caractères typographiques
    const txt = (s) => String(s ?? '').replace(/[\u202f\u00a0\u2009]/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[–—]/g, '-').replace(/œ/g, 'oe').replace(/Œ/g, 'OE');

    async function genererPDF(d, { retour = false } = {}) {
        let jsPDF;
        try { jsPDF = await chargerJsPDF(); } catch (e) { toast(e.message, 'err'); return; }
        const logo = await chargerLogo();
        const { lignes, totaux: t } = calculerTotaux(d);
        const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
        const W = 210, M = 16;
        const ROUGE = [215, 38, 56], NAVY = [11, 17, 32], GRIS = [100, 116, 139], LIGNE = [226, 232, 240];
        const E = ENTREPRISE;

        // Bandeau supérieur
        pdf.setFillColor(...NAVY); pdf.rect(0, 0, W, 4, 'F');
        pdf.setFillColor(...ROUGE); pdf.rect(0, 4, W, 1.2, 'F');

        // Logo + entreprise
        let y = 16;
        if (logo) pdf.addImage(logo.data, 'PNG', M, y - 2, 14, 14 * logo.h / logo.w);
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(17); pdf.setTextColor(...NAVY);
        pdf.text(txt(E.nom || 'Carapace').toUpperCase(), M + 19, y + 5, { charSpace: 1.2 });
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...GRIS);
        pdf.text(txt(E.slogan || ''), M + 19, y + 10);
        const infos = [E.raison_sociale, E.adresse, E.code_postal_ville, [E.telephone, E.email].filter(Boolean).join('  ·  '), E.siret ? 'SIRET : ' + E.siret : ''].filter(Boolean).map(txt);
        pdf.setFontSize(8.2); pdf.setTextColor(51, 65, 85);
        let yi = y + 22;
        infos.forEach((l) => { const parts = pdf.splitTextToSize(l, 92); pdf.text(parts, M, yi); yi += parts.length * 3.9; });

        // Titre DEVIS
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(30); pdf.setTextColor(...ROUGE);
        pdf.text('DEVIS', W - M, y + 7, { align: 'right' });
        pdf.setFontSize(10); pdf.setTextColor(...NAVY);
        pdf.text(txt('N° ' + (d.numero || '')), W - M, y + 14, { align: 'right' });
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.8); pdf.setTextColor(...GRIS);
        pdf.text(txt(`Date : ${dateFr(d.date_emission)}`), W - M, y + 19.5, { align: 'right' });
        pdf.text(txt(`Valable jusqu'au : ${dateFr(d.date_validite)}`), W - M, y + 24, { align: 'right' });

        // Bloc client
        const bx = 112, by = y + 30, bw = W - M - bx;
        const c = d.client || {};
        const clientLignes = [c.societe, [c.prenom, c.nom].filter(Boolean).join(' '), ...(String(c.adresse || '').split('\n')), c.contact].filter((s) => s && String(s).trim()).map(txt);
        const bh = Math.max(26, 11 + clientLignes.length * 4.4);
        pdf.setFillColor(248, 250, 252); pdf.setDrawColor(...LIGNE); pdf.roundedRect(bx, by, bw, bh, 2.5, 2.5, 'FD');
        pdf.setFillColor(...ROUGE); pdf.rect(bx, by + 3, 1.2, bh - 6, 'F');
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(...ROUGE);
        pdf.text('CLIENT', bx + 5, by + 6.5, { charSpace: .6 });
        pdf.setFontSize(9.6); pdf.setTextColor(...NAVY);
        let yc = by + 12;
        clientLignes.forEach((l, i) => {
            pdf.setFont('helvetica', i === 0 ? 'bold' : 'normal'); pdf.setFontSize(i === 0 ? 10 : 8.8);
            pdf.setTextColor(...(i === 0 ? NAVY : [51, 65, 85]));
            const parts = pdf.splitTextToSize(l, bw - 9); pdf.text(parts, bx + 5, yc); yc += parts.length * 4.4;
        });

        y = Math.max(by + bh, yi) + 8;
        if (d.objet) {
            pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(...NAVY);
            const o = pdf.splitTextToSize(txt('Objet : ' + d.objet), W - 2 * M); pdf.text(o, M, y); y += o.length * 4.6 + 2;
        }
        if (d.notes) {
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.8); pdf.setTextColor(51, 65, 85);
            const n = pdf.splitTextToSize(txt(d.notes), W - 2 * M); pdf.text(n, M, y); y += n.length * 4 + 3;
        }

        // Tableau des lignes
        const tvaCol = d.tva_franchise ? '-' : num(t.taux) + ' %';
        pdf.autoTable({
            startY: y + 1, margin: { left: M, right: M, bottom: 24 },
            head: [['Désignation', 'Qté', 'PU HT', 'TVA', 'Total HT']],
            body: lignes.length ? lignes.map((l) => [
                { content: txt(l.designation || '') + (l.description ? '\n' + txt(l.description) : ''), styles: {} },
                txt(num(l.quantite) + (l.unite ? ' ' + l.unite : '')), txt(eur(l.pu_ht)), tvaCol, txt(eur(l.total_ht))
            ]) : [[{ content: 'Aucune ligne', colSpan: 5, styles: { halign: 'center', textColor: GRIS } }]],
            theme: 'plain',
            styles: { font: 'helvetica', fontSize: 8.8, cellPadding: { top: 3, bottom: 3, left: 3, right: 3 }, textColor: [30, 41, 59], lineColor: LIGNE, lineWidth: { bottom: .2 } },
            headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8.2, lineWidth: 0 },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            columnStyles: { 0: { cellWidth: 'auto' }, 1: { halign: 'center', cellWidth: 18 }, 2: { halign: 'right', cellWidth: 27 }, 3: { halign: 'center', cellWidth: 16 }, 4: { halign: 'right', cellWidth: 29, fontStyle: 'bold' } },
            didParseCell: (h) => { if (h.section === 'head' && h.column.index > 0) h.cell.styles.halign = h.column.index === 1 || h.column.index === 3 ? 'center' : 'right'; }
        });
        y = pdf.lastAutoTable.finalY + 6;

        // Totaux
        const rows = [['Total HT', eur(t.ht_brut)]];
        if (t.remise) { rows.push([`Remise${d.remise_type === '%' ? ' ' + num(d.remise_valeur) + ' %' : ''}`, '- ' + eur(t.remise)]); rows.push(['Total HT après remise', eur(t.ht)]); }
        rows.push([d.tva_franchise ? 'TVA' : `TVA ${num(t.taux)} %`, eur(t.tva)]);
        const hTot = Math.max(rows.length * 6 + 14 + (t.acompte ? 7 : 0), 40);
        if (y + hTot > 272) { pdf.addPage(); y = 20; }
        const yTot = y;
        const tx = 118, tw = W - M - tx;
        pdf.setFontSize(9);
        rows.forEach(([k, v]) => {
            pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...GRIS); pdf.text(txt(k), tx, y);
            pdf.setTextColor(...NAVY); pdf.text(txt(v), W - M, y, { align: 'right' }); y += 6;
        });
        pdf.setFillColor(...ROUGE); pdf.roundedRect(tx - 3, y - 4, tw + 3, 11, 2, 2, 'F');
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(255);
        pdf.text('TOTAL TTC', tx, y + 3.2); pdf.text(txt(eur(t.ttc)), W - M - 2, y + 3.2, { align: 'right' });
        y += 13;
        if (t.acompte) {
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.8); pdf.setTextColor(...NAVY);
            pdf.text(txt(`Acompte à la signature (${num(d.acompte_pct)} %)`), tx, y); pdf.setFont('helvetica', 'bold'); pdf.text(txt(eur(t.acompte)), W - M, y, { align: 'right' }); y += 6;
        }
        if (d.tva_franchise) {
            pdf.setFont('helvetica', 'italic'); pdf.setFontSize(8.2); pdf.setTextColor(...GRIS);
            pdf.text('TVA non applicable, art. 293 B du CGI', W - M, y, { align: 'right' }); y += 5;
        }

        // Bon pour accord (à gauche des totaux)
        const sx = M, sy = yTot - 4, sw = 92, sh = 38;
        pdf.setDrawColor(...LIGNE); pdf.setLineWidth(.3);
        pdf.roundedRect(sx, sy, sw, sh, 2.5, 2.5, 'S');
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...NAVY);
        pdf.text('BON POUR ACCORD', sx + 4, sy + 6);
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.2); pdf.setTextColor(...GRIS);
        pdf.text(pdf.splitTextToSize(txt('Date, signature et mention manuscrite « Devis reçu avant l\'exécution des travaux, bon pour accord »'), sw - 8), sx + 4, sy + 10.5);
        pdf.setDrawColor(...LIGNE); pdf.setLineDashPattern([1, 1], 0); pdf.line(sx + 4, sy + sh - 6, sx + sw - 4, sy + sh - 6); pdf.setLineDashPattern([], 0);
        y = Math.max(y, sy + sh) + 2;

        // Conditions
        y += 4;
        if (d.conditions) {
            const cond = pdf.splitTextToSize(txt(d.conditions), W - 2 * M);
            if (y + 8 + cond.length * 3.7 > 279) { pdf.addPage(); y = 20; }
            pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...NAVY); pdf.text('CONDITIONS', M, y); y += 4.5;
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(71, 85, 105); pdf.text(cond, M, y); y += cond.length * 3.7 + 4;
        }
        if (E.iban) { pdf.setFontSize(8); pdf.setTextColor(71, 85, 105); pdf.text(txt('IBAN : ' + E.iban), M, y); y += 5; }

        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.6); pdf.setTextColor(...GRIS);
        pdf.text(pdf.splitTextToSize(txt('Merci pour votre confiance. Pour toute question sur ce devis, contactez-nous en rappelant son numéro.'), W - 2 * M), M, y);
        y += 6;

        // Pied de page (toutes les pages)
        const pied = [E.raison_sociale, E.forme_juridique, E.siret ? 'SIRET ' + E.siret : '', E.rcs_rm, E.tva_intra ? 'TVA ' + E.tva_intra : ''].filter(Boolean).map(txt).join(' · ');
        const pied2 = E.assurance ? txt('Assurance : ' + E.assurance) : '';
        const n = pdf.getNumberOfPages();
        for (let i = 1; i <= n; i++) {
            pdf.setPage(i);
            pdf.setDrawColor(...LIGNE); pdf.line(M, 282.5, W - M, 282.5);
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.6); pdf.setTextColor(...GRIS);
            const l1 = pdf.splitTextToSize(pied, W - 2 * M - 16);
            pdf.text(l1, M, 287);
            if (pied2) pdf.text(pdf.splitTextToSize(pied2, W - 2 * M - 16), M, 287 + l1.length * 2.9);
            pdf.text(`${i} / ${n}`, W - M, 287, { align: 'right' });
        }

        const nomFichier = `Devis-${(d.numero || "brouillon").replace(/[^A-Za-z0-9_-]/g, "_")}-${txt([c.nom, c.prenom].filter(Boolean).join('_') || c.societe || 'client').replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
        if (retour) return { pdf, nomFichier };
        pdf.save(nomFichier);
        toast('PDF téléchargé : ' + nomFichier);
    }

    // Avertit si on quitte la page avec un devis non enregistré
    window.addEventListener('beforeunload', (e) => { if (courant && modifie) { e.preventDefault(); e.returnValue = ''; } });

    return { chargerDevis, creerDepuisDemande, creerDepuisCommande, genererPDF, ouvrirEditeur, nouveauDevis };
}
