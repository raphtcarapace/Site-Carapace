// PDF de devis au modèle Alu'Topia : pages HTML (devis.css) puis image A4, sans en-tête navigateur.
const ASSET = 'assets/devis-modele/';
const DELAI_DEFAUT = '4 à 8 mois après le métrage, selon le produit';
const TEL_SOCIETE = '06 95 58 43 73';
const LEGAL = "ALU'TOPIA SARL au capital de 6 000 € – SIRET 950 824 987 00032 – APE 4332A – TVA FR47950824987 – RCS Dunkerque 950 824 987 – Assurance décennale souscrite auprès de Calipso Assurances";
const HTML2CANVAS = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function eur(n) {
    const neg = n < 0;
    const v = Math.abs(r2(n));
    const [ent, dec] = v.toFixed(2).split('.');
    return (neg ? '-' : '') + ent.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + dec + ' €';
}
function num(n) { return String(r2(n)).replace('.', ','); }
function dateFr(iso) {
    if (!iso) return '';
    const s = typeof iso === 'string' ? iso.slice(0, 10) : '';
    const [y, m, d] = s.split('-');
    return d && m && y ? `${d}/${m}/${y}` : '';
}
function estRemise(l) {
    if (!l) return false;
    if (l.type === 'remise' || l.remise) return true;
    if (/^\s*remise\b/i.test(String(l.designation || ''))) return true;
    return Number(l.pu_ht) < 0;
}
function tauxLigne(l, d) {
    if (d.tva_franchise) return 0;
    if (l.tva_taux == null || l.tva_taux === '') return Number(d.tva_taux) || 0;
    return Number(l.tva_taux) || 0;
}

/** Sous-total produits, remises, ventilation de TVA et échéancier. */
export function presentationDevis(d) {
    const src = Array.isArray(d.lignes) ? d.lignes : [];
    const toutes = src.map((l) => {
        const quantite = Number(l.quantite) || 0;
        const pu = Number(l.pu_ht) || 0;
        return {
            ...l,
            quantite,
            pu_ht: pu,
            total_ht: r2(quantite * pu),
            tva_taux: tauxLigne(l, d)
        };
    });
    const produits = toutes.filter((l) => !estRemise(l));
    let remises = toutes.filter(estRemise);
    const sousTotal = r2(produits.reduce((s, l) => s + l.total_ht, 0));
    if (!remises.length) {
        const rv = Math.max(0, Number(d.remise_valeur) || 0);
        const montant = r2(d.remise_type === '€' ? Math.min(rv, sousTotal) : sousTotal * Math.min(rv, 100) / 100);
        if (montant > 0.004) {
            const parTaux = new Map();
            produits.forEach((l) => parTaux.set(l.tva_taux, (parTaux.get(l.tva_taux) || 0) + l.total_ht));
            const base = [...parTaux.values()].reduce((a, b) => a + b, 0) || 1;
            const taux = [...parTaux.keys()];
            let reste = montant;
            taux.forEach((t, i) => {
                const part = i === taux.length - 1 ? r2(reste) : r2(montant * parTaux.get(t) / base);
                reste = r2(reste - part);
                if (!part) return;
                remises.push({
                    designation: taux.length > 1 ? `Remise commerciale (TVA ${num(t)} %)` : 'Remise commerciale',
                    quantite: 1,
                    pu_ht: -part,
                    total_ht: -part,
                    tva_taux: t,
                    type: 'remise'
                });
            });
        }
    }
    const map = new Map();
    [...produits, ...remises].forEach((l) => map.set(l.tva_taux, (map.get(l.tva_taux) || 0) + l.total_ht));
    const ventilation = d.tva_franchise ? [] : [...map.entries()]
        .map(([taux, base]) => ({ taux, base: r2(base), tva: r2(r2(base) * taux / 100) }))
        .filter((x) => x.base !== 0)
        .sort((a, b) => a.taux - b.taux);
    const ht = r2((d.tva_franchise ? sousTotal + remises.reduce((s, l) => s + l.total_ht, 0) : ventilation.reduce((s, x) => s + x.base, 0)));
    const tva = d.tva_franchise ? 0 : r2(ventilation.reduce((s, x) => s + x.tva, 0));
    const ttc = r2(ht + tva);
    const p1 = Math.min(100, Math.max(0, Number(d.acompte_pct) || 0));
    const p2 = Math.min(Math.max(0, 100 - p1), Math.max(0, Number(d.acompte2_pct) || 0));
    const a1 = r2(ttc * p1 / 100);
    const a2 = r2(ttc * p2 / 100);
    const solde = r2(ttc - a1 - a2);
    return {
        produits, remises, sousTotal, ventilation, ht, tva, ttc,
        acompte1: a1, acompte2: a2, solde, pct1: p1, pct2: p2, pctSolde: r2(100 - p1 - p2)
    };
}

function nomClient(c) {
    const nom = String(c.nom || '').trim();
    const prenom = String(c.prenom || '').trim();
    if (nom && prenom) return `${nom.toUpperCase()} ${prenom}`;
    if (nom) return nom.toUpperCase();
    if (prenom) return prenom;
    return String(c.societe || '').trim();
}
function lignesAdresse(c) {
    const qui = nomClient(c);
    const societe = String(c.societe || '').trim();
    const adr = String(c.adresse || '').split(/\n/).map((s) => s.trim()).filter(Boolean);
    return [...(societe && qui && societe.toUpperCase() !== qui.toUpperCase() ? [societe] : []), ...adr];
}
function contactTexte(c) {
    if (!c) return '';
    const nom = String(c.nom || '').trim();
    const tel = String(c.telephone || '').trim();
    if (nom || tel) return [nom, tel].filter(Boolean).join(' ');
    return String(c.email || '').trim();
}
function qteTexte(l) {
    const q = num(l.quantite);
    return l.unite ? `${q} ${l.unite}` : q;
}
function colonne(arr) {
    return (Array.isArray(arr) ? arr : []).map((item) => {
        const label = Array.isArray(item) ? item[0] : (item && (item.label || item.l));
        const texte = Array.isArray(item) ? item[1] : (item && (item.texte || item.t));
        if (!label && !texte) return '';
        return `<li><b>${esc(label)} :</b> ${esc(texte)}</li>`;
    }).join('');
}
function htmlDescriptif(desc) {
    if (!desc || typeof desc !== 'object') return '';
    const g = colonne(desc.gauche);
    const dr = colonne(desc.droite);
    if (!desc.titre && !g && !dr) return '';
    return `<tr class="descr"><td colspan="5"><div class="descbox"><div class="dhead"><span class="kick">DESCRIPTIF GÉNÉRAL</span><span class="dtitle">${esc(desc.titre || '')}</span></div><div class="dcols"><ul>${g}</ul><ul>${dr}</ul></div></div></td></tr>`;
}
function htmlItem(l, remise) {
    const contenu = Array.isArray(l.contenu) ? l.contenu.map((s) => String(s || '').trim()).filter(Boolean) : [];
    const repere = l.repere ? `<span class="repere">${esc(String(l.repere).toUpperCase())}</span>` : '';
    const thumb = l.image ? `<img class="thumb" alt="" src="${esc(l.image)}">` : '';
    const pack = contenu.length ? `<ul class="packul">${contenu.map((it) => `<li>${esc(it)}</li>`).join('')}</ul>` : '';
    const sub = l.description ? `<div class="sub">${esc(l.description)}</div>` : '';
    const taux = `${num(l.tva_taux)} %`;
    return `<tr class="item${remise ? ' remise' : ''}"><td class="des">${repere}<div class="pname-row">${thumb}<div><div class="pname">${esc(l.designation || '')}</div>${pack}${sub}</div></div></td><td class="c">${esc(qteTexte(l))}</td><td class="r">${esc(eur(l.pu_ht))}</td><td class="r b">${esc(eur(l.total_ht))}</td><td class="r tva">${esc(taux)}</td></tr>`;
}
const THEAD = '<thead><tr><th class="des">DÉSIGNATION</th><th class="c">QTÉ</th><th class="r">P.U. HT</th><th class="r">TOTAL HT</th><th class="r">TVA</th></tr></thead>';

function htmlEntete(d) {
    const c = d.client || {};
    const draft = (d.statut || 'brouillon') === 'brouillon' ? '<div class="draft">BROUILLON — DOCUMENT NON CONTRACTUEL</div>' : '';
    const contact = contactTexte(d.contact);
    const delai = d.delai || DELAI_DEFAUT;
    const badge = d.badge || 'FOURNITURE ET POSE';
    const adr = lignesAdresse(c).map((l) => `<div>${esc(l)}</div>`).join('');
    return `${draft}
<header class="brand">
  <div class="bl"><img class="clogo" src="${ASSET}carapace-mark.png" alt="Carapace"></div>
  <div class="bm"><div class="bname">CARAPACE</div><div class="bslogan">La protection de vos espaces</div></div>
  <div class="br">15 rue du Guindal<br>59630 Bourbourg<br>contact@alutopia.fr<br><b>alutopia.fr</b></div>
</header>
<div class="bandeau"><i></i><i class="red"></i></div>
<div class="row2">
  <div class="tel"><span class="lbl">TÉL.</span> ${TEL_SOCIETE}</div>
  <div class="client"><div class="cname">${esc(nomClient(c) || 'Client')}</div>${adr}</div>
</div>
<div class="titlebox">
  <div class="tt">DEVIS N° ${esc(d.numero || '')} <span>du ${esc(dateFr(d.date_emission) || '—')}</span></div>
  <div class="meta">${contact ? `<span class="lbl">VOTRE CONTACT</span> ${esc(contact)} ` : ''}<span class="lbl" style="margin-left:${contact ? '18px' : '0'}">DÉLAI</span> ${esc(delai)}</div>
  <div class="pill">${esc(badge)}</div>
</div>
<table class="lines">${THEAD}<tbody></tbody></table>`;
}
function htmlNote(d) {
    const jusquau = dateFr(d.date_validite);
    const delai = d.delai || DELAI_DEFAUT;
    const validite = jusquau ? `ce devis est valable 1 mois (jusqu'au ${jusquau})` : 'ce devis est valable 1 mois';
    const extra = d.notes ? ` ${d.notes}` : '';
    return `<div class="note">Images et photos non contractuelles, ${esc(validite)}. Les cotes indiquées sont à confirmer lors du métré sur site. Toute modification après signature fera l'objet d'un avenant. Délai : ${esc(delai)}.${esc(extra)}</div>`;
}
function htmlTotaux(d, p) {
    const lignesTva = p.ventilation.length
        ? p.ventilation.map((v) => `<tr><td>${esc(num(v.taux))} %</td><td class="r">${esc(eur(v.base))}</td><td class="r">${esc(eur(v.tva))}</td></tr>`).join('')
        : `<tr><td colspan="3">${d.tva_franchise ? 'TVA non applicable, art. 293 B du CGI' : '—'}</td></tr>`;
    const cert = p.ventilation.some((v) => r2(v.taux) === 10) ? `<div class="cert">
  <div class="ctext"><div class="kick sq">CERTIFICATION DU CLIENT — TVA À TAUX RÉDUIT</div>
  <p>Je soussigné(e) ${esc(nomClient(d.client || {}) || 'le client')} certifie, en qualité de preneur de la prestation, que les travaux réalisés concernent des locaux à usage d'habitation achevés depuis plus de deux ans, qu'ils n'auront pas pour effet, sur une période de deux ans au plus, de concourir à la production d'un immeuble neuf au sens du 2° du 2 du I de l'article 257 du CGI, ni d'entraîner une augmentation de la surface de plancher des locaux existants supérieure à 10 %. Articles 279-0 bis et 278-0 bis A du code général des impôts.</p></div>
  <div class="sig small1"><span>DATE</span></div><div class="sig"><span>SIGNATURE DU CLIENT</span></div>
</div>` : '';
    return `${htmlNote(d)}
<div class="totrow">
  <div class="tvad">
    <div class="kick">DÉTAIL TVA</div>
    <table class="tvat"><tr><th>Taux</th><th class="r">Base HT</th><th class="r">TVA</th></tr>${lignesTva}</table>
    <p class="small">Nos prix sont établis sur la base des taux de TVA en vigueur à la date de la remise de l’offre. Toute variation ultérieure de ces taux, imposés par la loi, sera répercutée sur ces prix.</p>
    <ul class="pay">
      <li>Règlement : <b>Paiement comptant — échéancier adapté : acompte n°1 ${esc(num(p.pct1))} % · acompte n°2 ${esc(num(p.pct2))} % · solde ${esc(num(p.pctSolde))} %</b></li>
      <li>Acompte n°1 : <b>${esc(eur(p.acompte1))} TTC</b> (${esc(num(p.pct1))} %)</li>
      <li>Acompte n°2 : <b>${esc(eur(p.acompte2))} TTC</b> (${esc(num(p.pct2))} %)</li>
      <li>Solde : <b>${esc(eur(p.solde))} TTC</b></li>
    </ul>
  </div>
  <div class="tots">
    <div class="tl"><span>Total HT</span><b>${esc(eur(p.ht))}</b></div>
    <div class="tl"><span>Total TVA</span><b>${esc(eur(p.tva))}</b></div>
    <div class="ttc"><span>TOTAL TTC</span><b>${esc(eur(p.ttc))}</b></div>
  </div>
</div>
${cert}
<div class="bpa">
  <div class="btext"><div class="kick sq">BON POUR ACCORD</div>
  <p>Je soussigné(e) accepte le présent devis n° ${esc(d.numero || '')} d'un montant de <b>${esc(eur(p.ttc))} TTC</b>.</p>
  <p>Je déclare avoir pris connaissance et accepté les conditions générales de vente ci-jointes.</p>
  <p class="muted">Fait à : ………………… — Le : ……/……/…………</p>
  <p class="muted">Signature précédée de la mention « Lu et approuvé, devis reçu avant l'exécution des travaux »</p></div>
  <div class="sig big"><span>SIGNATURE DU CLIENT</span></div>
</div>`;
}
function htmlRetract(d) {
    const c = d.client || {};
    const adr = lignesAdresse(c).join(', ');
    return `<div class="retract">
  <div class="rt">FORMULAIRE DE RÉTRACTATION</div>
  <p>À compléter et renvoyer uniquement si vous souhaitez vous rétracter du contrat (Code de la consommation, articles L.221-18 et suivants, annexe à l'article R.221-1).</p>
  <p>À l'attention de <b>ALU'TOPIA, 15 rue du Guindal, 59630 Bourbourg, contact@alutopia.fr</b> :</p>
  <p>Je/Nous (*) vous notifie/notifions (*) par la présente ma/notre (*) rétractation du contrat portant sur la vente du bien (*)/pour la prestation de services (*) ci-dessous :</p>
  <p>Devis n° <b>${esc(d.numero || '')}</b> du ${esc(dateFr(d.date_emission) || '—')}</p>
  <p>Commandé le (*)/reçu le (*) : <b>date de signature du devis</b></p>
  <p>Nom du consommateur ou des consommateurs : <b>${esc(nomClient(c))}</b></p>
  <p>Adresse du consommateur ou des consommateurs : <b>${esc(adr)}</b></p>
  <p>Signature du consommateur ou des consommateurs (uniquement en cas de notification du présent formulaire sur papier) :</p>
  <div class="rsig"><span>Signature</span></div>
  <p>Date : ……/……/…………</p>
  <p class="muted">(*) Rayez la mention inutile.</p>
</div>`;
}
function pied() {
    return `<footer class="foot"><img src="${ASSET}logo-alutopia.png" alt="Alu'Topia"><span>${LEGAL}</span></footer>`;
}
function nomFichier(d) {
    const c = d.client || {};
    const qui = [c.nom, c.prenom].filter(Boolean).join('_') || c.societe || 'client';
    const propre = (s) => String(s || 'brouillon').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_');
    return `Devis-${propre(d.numero)}-${propre(qui)}.pdf`;
}

function chargerScript(doc, src) {
    return new Promise((res, rej) => {
        if ([...doc.scripts].some((s) => s.src === src)) return res();
        const s = doc.createElement('script');
        s.src = src;
        s.onload = res;
        s.onerror = () => rej(new Error('Impossible de charger le module PDF (connexion internet ?)'));
        doc.head.appendChild(s);
    });
}
function attendreImages(doc) {
    return Promise.all([...doc.images].map((img) => (img.complete && img.naturalWidth) ? null : new Promise((res) => {
        img.onload = img.onerror = res;
    })));
}
function imageSaine(url) {
    const s = String(url || '').trim();
    if (!s) return Promise.resolve(false);
    if (/^(assets\/|\/assets\/)/.test(s) || (typeof location !== 'undefined' && s.startsWith(location.origin + '/'))) return Promise.resolve(true);
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const stop = (v) => { clearTimeout(timer); resolve(v); };
        const timer = setTimeout(() => stop(false), 6000);
        img.onload = () => {
            try {
                const c = document.createElement('canvas');
                c.width = 1; c.height = 1;
                c.getContext('2d').drawImage(img, 0, 0);
                c.toDataURL();
                stop(true);
            } catch (_) { stop(false); }
        };
        img.onerror = () => stop(false);
        img.src = s;
    });
}
function debord(page) {
    const foot = page.querySelector('.foot');
    const flux = [...page.children].filter((el) => !el.classList.contains('foot') && !el.classList.contains('runhead'));
    const last = flux[flux.length - 1];
    if (!foot || !last) return false;
    return last.getBoundingClientRect().bottom > foot.getBoundingClientRect().top - 1;
}

export async function monterDevis(d) {
    const pres = presentationDevis(d);
    for (const l of [...pres.produits, ...pres.remises]) {
        if (l.image && !(await imageSaine(l.image))) l.image = '';
    }
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('scrolling', 'no');
    iframe.style.cssText = 'position:fixed;left:-240mm;top:0;width:210mm;height:297mm;border:0;background:#fff';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    doc.open();
    doc.write('<!doctype html><html lang="fr"><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Montserrat:wght@700;800;900&display=swap"></head><body></body></html>');
    doc.close();
    await new Promise((res, rej) => {
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = `${ASSET}devis.css?v=2`;
        link.onload = res;
        link.onerror = () => rej(new Error('Feuille de style du devis introuvable.'));
        doc.head.appendChild(link);
    });
    try {
        await doc.fonts.ready;
        await Promise.all([
            doc.fonts.load('400 9pt Inter'),
            doc.fonts.load('700 10pt Inter'),
            doc.fonts.load('800 12pt Montserrat'),
            doc.fonts.load('900 22pt Montserrat')
        ]);
    } catch (_) { /* le PDF reste lisible avec la police de secours */ }

    const creer = (premiere) => {
        const sec = doc.createElement('section');
        sec.className = 'page';
        sec.innerHTML = `<div class="runhead"></div>${premiere ? htmlEntete(d) : `<table class="lines top">${THEAD}<tbody></tbody></table>`}${pied()}`;
        doc.body.appendChild(sec);
        return sec;
    };
    let page = creer(true);
    const poser = (morceaux) => {
        let tb = page.querySelector('tbody');
        const avant = tb.children.length;
        morceaux.forEach((h) => { if (h) tb.insertAdjacentHTML('beforeend', h); });
        if (!debord(page)) return;
        while (tb.children.length > avant) tb.lastElementChild.remove();
        const peutCouper = avant > 0 || !!page.querySelector('.brand');
        if (!peutCouper) {
            morceaux.forEach((h) => { if (h) tb.insertAdjacentHTML('beforeend', h); });
            return;
        }
        page = creer(false);
        tb = page.querySelector('tbody');
        morceaux.forEach((h) => { if (h) tb.insertAdjacentHTML('beforeend', h); });
    };
    if (!pres.produits.length && !pres.remises.length) {
        poser(['<tr class="item"><td class="des" colspan="5"><div class="pname">Aucune ligne</div></td></tr>']);
    }
    pres.produits.forEach((l) => poser([htmlDescriptif(l.descriptif), htmlItem(l, false)].filter(Boolean)));
    const sous = `<tr class="stglob"><td colspan="5"><span class="gst">Sous-total <b>${esc(eur(pres.sousTotal))} HT</b></span></td></tr>`;
    poser([sous, ...pres.remises.map((l) => htmlItem(l, true))]);

    const bloc = doc.createElement('div');
    bloc.innerHTML = htmlTotaux(d, pres);
    const noeuds = [...bloc.childNodes];
    const coller = (cible) => {
        const foot = cible.querySelector('.foot');
        noeuds.forEach((n) => cible.insertBefore(n, foot));
    };
    coller(page);
    if (debord(page)) {
        page.classList.add('compact');
        if (debord(page)) {
            page.classList.remove('compact');
            noeuds.forEach((n) => n.remove());
            page = creer(false);
            const table = page.querySelector('table');
            if (table && !table.querySelector('tbody').children.length) table.remove();
            coller(page);
            if (debord(page)) page.classList.add('compact');
        }
    }

    const auth = doc.createElement('section');
    auth.className = 'page';
    auth.innerHTML = `<div class="runhead"></div><div class="image-auth"><div class="kick sq">AUTORISATION DE DROIT À L'IMAGE (FACULTATIVE)</div><p>J'autorise ALU'TOPIA à photographier et filmer le chantier et les réalisations du devis n° ${esc(d.numero || '')}, et à publier ces images sur son site internet, ses réseaux sociaux et ses supports commerciaux, sans limitation de durée ni de territoire et sans rémunération, hors toute atteinte à la vie privée. Cette autorisation est indépendante du devis : la refuser ne change rien à votre commande.</p><div class="checks"><span>☐ J'accepte</span><span>☐ Je refuse</span></div></div>${pied()}`;
    doc.body.appendChild(auth);
    for (let i = 1; i <= 9; i++) {
        const sec = doc.createElement('section');
        sec.className = 'page cgvpage';
        const n = String(i).padStart(2, '0');
        sec.innerHTML = `<div class="runhead"></div><img class="cgv" src="${ASSET}cgv-${n}.png" alt="Conditions générales de vente, page ${i}">${i === 2 ? htmlRetract(d) : ''}${pied()}`;
        doc.body.appendChild(sec);
    }
    const pages = [...doc.querySelectorAll('.page')];
    const total = pages.length;
    pages.forEach((p, i) => {
        p.querySelector('.runhead').textContent = `Devis n° ${d.numero || ''} · page ${i + 1} / ${total}`;
    });
    await attendreImages(doc);
    return { iframe, doc, pages: total, presentation: pres, nom: nomFichier(d) };
}

async function rasteriser(doc) {
    await chargerScript(doc, HTML2CANVAS);
    await chargerScript(doc, JSPDF);
    const html2canvas = doc.defaultView.html2canvas;
    const { jsPDF } = doc.defaultView.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const pages = [...doc.querySelectorAll('.page')];
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        pages.forEach((p) => { p.style.display = p === page ? '' : 'none'; });
        const canvas = await html2canvas(page, {
            scale: 2,
            useCORS: true,
            allowTaint: false,
            backgroundColor: '#ffffff',
            width: page.offsetWidth,
            height: page.offsetHeight,
            windowWidth: page.offsetWidth,
            windowHeight: page.offsetHeight,
            logging: false
        });
        const img = canvas.toDataURL('image/jpeg', 0.92);
        canvas.width = 0; canvas.height = 0;
        if (i) pdf.addPage();
        pdf.addImage(img, 'JPEG', 0, 0, 210, 297);
    }
    pages.forEach((p) => { p.style.display = ''; });
    return pdf;
}

export async function genererDevisPdf(d, opts = {}) {
    const montage = await monterDevis(d);
    try {
        if (opts.apercu) return montage;
        const pdf = await rasteriser(montage.doc);
        pdf.setProperties({ title: `Devis ${d.numero || ''}`, creator: 'Carapace' });
        if (opts.enregistrer !== false) pdf.save(montage.nom);
        return { nom: montage.nom, pages: montage.pages, presentation: montage.presentation, pdf };
    } finally {
        if (!opts.garder) montage.iframe.remove();
    }
}
