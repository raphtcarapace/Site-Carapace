// Aide au devis : achat à l'unité ou pack + compléments, sur les prix de vente TTC du catalogue.
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function eur(n) {
    const neg = n < 0;
    const v = Math.abs(r2(n));
    const [ent, dec] = v.toFixed(2).split('.');
    return (neg ? '-' : '') + ent.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + dec + ' €';
}
function pct(n) {
    const v = Math.round(n * 10) / 10;
    return String(v).replace('.', ',') + ' %';
}

export function normaliserNom(s) {
    return String(s ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/®/g, '')
        .replace(/['’]/g, ' ')
        .replace(/[^a-z0-9+]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function tokens(s) {
    return normaliserNom(s).split(' ').filter((t) => t && t !== 'jeweller');
}
export function quantiteEtTexte(ligne) {
    const brut = String(ligne ?? '').trim();
    const mult = /^(\d+)\s*[x×]\s+(.+)$/i.exec(brut);
    if (mult) return { qte: Math.max(1, parseInt(mult[1], 10) || 1), texte: mult[2].trim() };
    const lead = /^(\d+)\s+(.+)$/.exec(brut);
    if (lead) return { qte: Math.max(1, parseInt(lead[1], 10) || 1), texte: lead[2].trim() };
    return { qte: 1, texte: brut };
}
function prixTtc(p) {
    const n = parseFloat(p && p.prix);
    return Number.isFinite(n) && n > 0 ? n : null;
}
function htDe(ttc, taux) {
    return r2(ttc / (1 + (Number(taux) || 0) / 100));
}
export function estCentrale(p) {
    if (!p || p.est_pack) return false;
    const marque = String(p.marque || '').toLowerCase();
    const nom = normaliserNom(p.nom);
    const cat = normaliserNom(p.categorie || '');
    if (marque === 'ajax') return cat === 'centrales' || /(^| )hub( |$)/.test(nom);
    if (marque === 'somfy') return /^tahoma\b/.test(nom);
    if (marque === 'yale') return nom.includes('connectx') || /(^| )bridge( |$)/.test(nom);
    return cat.includes('centrale') || /(^| )hub( |$)/.test(nom);
}
function listeProduits(produits) {
    return Object.entries(produits || {}).map(([id, p]) => ({ id, ...p }));
}
function aContenu(p) {
    return Array.isArray(p.contenu_pack) && p.contenu_pack.some((s) => String(s || '').trim());
}

export function associerTexte(texte, produits, marque) {
    const brut = String(texte || '').trim();
    const liste = listeProduits(produits);
    if (!brut) return { produit: null, certain: false, candidats: [] };
    const direct = liste.find((p) => p.id === brut);
    if (direct) return { produit: direct, certain: true, candidats: [direct] };
    const ref = normaliserNom(brut).replace(/ /g, '');
    const parRef = ref ? liste.filter((p) => normaliserNom(p.reference || '').replace(/ /g, '') === ref) : [];
    if (parRef.length === 1) return { produit: parRef[0], certain: true, candidats: parRef };
    if (parRef.length > 1) return { produit: parRef[0], certain: false, candidats: parRef };
    const exact = liste.filter((p) => normaliserNom(p.nom) === normaliserNom(brut) && (!marque || String(p.marque || '').toLowerCase() === marque));
    if (exact.length === 1) return { produit: exact[0], certain: true, candidats: exact };
    const qTokens = tokens(brut);
    if (!qTokens.length) return { produit: null, certain: false, candidats: [] };
    const pool = liste.filter((p) => !marque || String(p.marque || '').toLowerCase() === marque);
    const notes = pool.map((p) => {
        const pt = tokens(p.nom);
        if (!qTokens.every((t) => pt.includes(t))) return null;
        return { p, extra: pt.filter((t) => !qTokens.includes(t)).length };
    }).filter(Boolean).sort((a, b) => a.extra - b.extra || (prixTtc(a.p) ?? 1e12) - (prixTtc(b.p) ?? 1e12) || String(a.p.nom).length - String(b.p.nom).length);
    if (!notes.length) return { produit: null, certain: false, candidats: [] };
    const tied = notes.filter((n) => n.extra === notes[0].extra);
    return { produit: tied[0].p, certain: tied.length === 1, candidats: tied.map((t) => t.p) };
}

function familleHub(marque, selection) {
    if (selection.some(estCentrale)) return null;
    if (marque === 'ajax') return 'ajax';
    if (marque === 'somfy') {
        const alarme = selection.some((p) => /intellitag|home alarm|one \+|sirene|clavier interieur|detecteur de mouvement interieur|detecteur de fumee/.test(normaliserNom(p.nom)));
        return alarme ? 'alarme-somfy' : 'domotique';
    }
    if (marque === 'yale') {
        if (selection.some((p) => normaliserNom(p.categorie || '') === 'alarmes')) return 'alarme-yale';
        const serrure = selection.some((p) => /serrure|maison connectee|coffre/.test(normaliserNom(p.categorie || '')));
        const wifi = selection.some((p) => /wi fi|wifi/.test(normaliserNom(p.nom)));
        if (serrure && !wifi) return 'bridge';
        return null;
    }
    return 'generique';
}
function hubsMarque(produits, marque, famille) {
    return listeProduits(produits)
        .filter((p) => String(p.marque || '').toLowerCase() === marque && estCentrale(p) && prixTtc(p))
        .filter((p) => {
            const n = normaliserNom(p.nom);
            if (famille === 'alarme-somfy') return n.includes('link');
            if (famille === 'alarme-yale') return false;
            if (famille === 'bridge') return n.includes('connectx') || n.includes('bridge');
            if (famille === 'domotique') return n.startsWith('tahoma');
            return true;
        })
        .sort((a, b) => prixTtc(a) - prixTtc(b));
}

function lignePrix(p, qte, taux) {
    const ttc = prixTtc(p);
    if (ttc == null) return { id: p.id, nom: p.nom || '', qte, puHt: null, totalHt: null, sansPrix: true };
    const pu = htDe(ttc, taux);
    return { id: p.id, nom: p.nom || '', qte, puHt: pu, totalHt: r2(pu * qte), sansPrix: false };
}

export function calculerAide(produits, { marque = 'ajax', besoins = [], taux = 20 } = {}) {
    const m = String(marque || '').toLowerCase();
    const catalogue = listeProduits(produits).filter((p) => String(p.marque || '').toLowerCase() === m);
    const parId = new Map(listeProduits(produits).map((p) => [p.id, p]));
    const packsVides = catalogue.filter((p) => p.est_pack && !aContenu(p)).map((p) => ({ id: p.id, nom: p.nom || 'Pack' }));
    const selection = [];
    besoins.forEach((b) => {
        const p = parId.get(b.id);
        const qte = Math.max(0, Math.round(Number(b.qte) || 0));
        if (p && qte > 0 && String(p.marque || '').toLowerCase() === m) selection.push({ ...p, qte });
    });
    const famille = selection.length ? familleHub(m, selection) : null;
    let hub = null;
    let avertissement = '';
    if (famille) {
        const candidats = hubsMarque(produits, m, famille);
        if (candidats.length) {
            hub = candidats[0];
            avertissement = `Aucune centrale n'est dans la sélection. La moins chère a été ajoutée : ${hub.nom}.`;
        } else if (famille === 'alarme-somfy') {
            avertissement = "Aucune centrale Home Alarm n'est vendue à l'unité dans le catalogue. Le total ne comprend pas de Link.";
        } else if (famille === 'alarme-yale') {
            avertissement = "Aucune centrale d'alarme Yale n'est vendue à l'unité dans le catalogue. Le total ne comprend pas de centrale.";
        } else {
            avertissement = 'Une centrale est nécessaire, mais aucune centrale avec un prix de vente n’est au catalogue pour cette marque.';
        }
    }
    const lignesIndiv = selection.map((p) => lignePrix(p, p.qte, taux));
    if (hub) lignesIndiv.push({ ...lignePrix(hub, 1, taux), centrale: true });
    const totalIndiv = r2(lignesIndiv.reduce((s, l) => s + (l.totalHt || 0), 0));
    const incompletIndiv = lignesIndiv.some((l) => l.sansPrix);

    const besoinsQte = new Map(lignesIndiv.map((l) => [l.id, l.qte]));
    let meilleur = null;
    catalogue.filter((p) => p.est_pack && aContenu(p) && prixTtc(p)).forEach((pack) => {
        const fourni = new Map();
        const incertains = [];
        const nonApparies = [];
        pack.contenu_pack.forEach((ligne) => {
            const { qte, texte } = quantiteEtTexte(ligne);
            if (!texte) return;
            const match = associerTexte(texte, produits, m);
            if (!match.produit) { nonApparies.push(String(ligne)); return; }
            fourni.set(match.produit.id, (fourni.get(match.produit.id) || 0) + qte);
            if (!match.certain) incertains.push({ texte, retenu: match.produit.nom, autres: match.candidats.slice(1, 4).map((c) => c.nom) });
        });
        const extras = [];
        const couvertParCentrale = new Map();
        besoinsQte.forEach((qte, id) => {
            const p = parId.get(id);
            const ligne = lignesIndiv.find((l) => l.id === id);
            if (ligne && ligne.centrale) {
                const autre = [...fourni.entries()].find(([fid, fq]) => fq > 0 && estCentrale(parId.get(fid)));
                if (autre) { couvertParCentrale.set(autre[0], (couvertParCentrale.get(autre[0]) || 0) + 1); return; }
            }
            const manque = qte - (fourni.get(id) || 0);
            if (manque > 0 && p) extras.push(lignePrix(p, manque, taux));
        });
        const bonus = [];
        fourni.forEach((qte, id) => {
            const dem = (besoinsQte.get(id) || 0) + (couvertParCentrale.get(id) || 0);
            if (qte > dem) {
                const p = parId.get(id);
                bonus.push({ nom: p ? p.nom : id, qte: qte - dem });
            }
        });
        const packHt = htDe(prixTtc(pack), taux);
        const total = r2(packHt + extras.reduce((s, l) => s + (l.totalHt || 0), 0));
        const candidat = { packId: pack.id, nom: pack.nom || 'Pack', packHt, extras, bonus, incertains, nonApparies, totalHt: total, sansPrix: extras.some((l) => l.sansPrix) };
        if (!meilleur || candidat.totalHt < meilleur.totalHt) meilleur = candidat;
    });

    let economie = null;
    let economiePct = null;
    let recommandation = 'individuel';
    if (meilleur && !incompletIndiv && !meilleur.sansPrix) {
        economie = r2(totalIndiv - meilleur.totalHt);
        economiePct = totalIndiv > 0 ? (economie / totalIndiv) * 100 : null;
        if (economie > 0.009) recommandation = 'kit';
    }
    return {
        taux: Number(taux) || 0,
        packsVides,
        avertissement,
        individuel: { lignes: lignesIndiv, totalHt: totalIndiv, incomplet: incompletIndiv },
        kit: meilleur,
        economie,
        economiePct,
        recommandation
    };
}

function nomsMarques(produits) {
    const presentes = new Set(listeProduits(produits).map((p) => String(p.marque || '').toLowerCase()).filter(Boolean));
    const ordre = ['ajax', 'yale', 'somfy'].filter((m) => presentes.has(m));
    const autres = [...presentes].filter((m) => !ordre.includes(m)).sort();
    return [...ordre, ...autres];
}
function libelleMarque(m) {
    return { ajax: 'Ajax', yale: 'Yale', somfy: 'Somfy' }[m] || (m ? m.charAt(0).toUpperCase() + m.slice(1) : 'Autre');
}

export function monterAide({ getProduits, devisOuvert, tauxDevis, ajouterLignes, toast }) {
    const slot = document.getElementById('aide-slot');
    const inline = document.getElementById('aide-inline');
    const inlineSlot = document.getElementById('aide-inline-slot');
    if (!slot || !inline || !inlineSlot) return { ranger() {} };
    const outil = document.createElement('div');
    outil.id = 'aide-outil';
    outil.innerHTML = `
        <div class="aide-bar">
            <label>Marque<select id="aide-marque"></select></label>
            <label class="grow">Produit<input type="search" id="aide-search" placeholder="Nom ou référence, ex. DoorProtect" autocomplete="off"></label>
        </div>
        <div id="aide-resultats" class="aide-resultats"></div>
        <div id="aide-besoins" class="aide-besoins"></div>
        <div id="aide-comparaison"></div>`;
    slot.appendChild(outil);
    let marque = 'ajax';
    let besoins = [];

    const $ = (id) => outil.querySelector('#' + id);
    function placer(ou) {
        if (ou === 'inline') { inlineSlot.appendChild(outil); inline.hidden = false; inline.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        else { slot.appendChild(outil); inline.hidden = true; }
    }
    function majMarques() {
        const marques = nomsMarques(getProduits());
        if (!marques.includes(marque)) marque = marques[0] || 'ajax';
        $('aide-marque').innerHTML = marques.map((m) => `<option value="${esc(m)}">${esc(libelleMarque(m))}</option>`).join('')
            || '<option value="ajax">Ajax</option>';
        $('aide-marque').value = marque;
    }
    function rendu() {
        majMarques();
        const prods = getProduits() || {};
        const q = $('aide-search').value.toLowerCase().trim();
        const trouves = listeProduits(prods).filter((p) => String(p.marque || '').toLowerCase() === marque).filter((p) => {
            if (!q) return false;
            return [p.nom, p.reference, p.categorie].join(' ').toLowerCase().includes(q);
        }).sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr')).slice(0, 8);
        $('aide-resultats').innerHTML = trouves.map((p) => {
            const ttc = prixTtc(p);
            return `<button type="button" class="aide-hit" data-ajout="${esc(p.id)}"><span><b>${esc(p.nom)}</b><small>${esc(p.categorie || p.reference || '')}</small></span><em>${ttc ? esc(eur(ttc)) + ' TTC' : 'Sur devis'}</em></button>`;
        }).join('') || (q ? '<p class="hint">Aucun produit pour cette recherche.</p>' : '');
        $('aide-besoins').innerHTML = besoins.length ? besoins.map((b) => {
            const p = prods[b.id];
            return `<div class="aide-besoin"><div><b>${esc(p ? p.nom : b.id)}</b></div><div class="aide-qte"><button type="button" data-q="-1" data-id="${esc(b.id)}" aria-label="Diminuer">−</button><input type="number" min="1" step="1" value="${esc(b.qte)}" data-saisie="${esc(b.id)}" aria-label="Quantité"><button type="button" data-q="1" data-id="${esc(b.id)}" aria-label="Augmenter">+</button></div><button type="button" class="btn btn-ghost" data-retirer="${esc(b.id)}">Retirer</button></div>`;
        }).join('') : '<p class="hint">Indiquez les quantités, par exemple 3 DoorProtect, 2 MotionProtect, 1 KeyPad, 1 HomeSiren.</p>';
        const res = besoins.length ? calculerAide(prods, { marque, besoins, taux: tauxDevis() }) : null;
        $('aide-comparaison').innerHTML = res ? htmlComparaison(res, devisOuvert()) : '';
    }
    function htmlComparaison(res, ouvert) {
        const tauxTxt = res.taux ? `HT, prix de vente TTC ÷ ${String(res.taux).replace('.', ',')} % de TVA` : 'HT, TVA non applicable sur le devis en cours';
        const indiv = res.individuel;
        const kit = res.kit;
        const reco = res.recommandation;
        const carteInd = `<article class="aide-card${reco === 'individuel' ? ' reco' : ''}"><h4>À l'unité${reco === 'individuel' ? ' · recommandé' : ''}</h4><div class="prix">${esc(eur(indiv.totalHt))} <small>HT</small></div><ul>${indiv.lignes.map((l) => `<li>${l.qte} × ${esc(l.nom)}${l.centrale ? ' (centrale ajoutée)' : ''}${l.sansPrix ? ' — sans prix de vente' : ` · ${esc(eur(l.totalHt))} HT`}</li>`).join('')}</ul><div class="aide-actions"><button type="button" class="btn ${reco === 'individuel' ? 'btn-primary' : 'btn-secondary'}" data-ajouter="individuel">Ajouter au devis</button></div></article>`;
        const carteKit = kit ? `<article class="aide-card${reco === 'kit' ? ' reco' : ''}"><h4>Pack + compléments${reco === 'kit' ? ' · recommandé' : ''}</h4><div class="prix">${esc(eur(kit.totalHt))} <small>HT</small></div><p><b>${esc(kit.nom)}</b> · ${esc(eur(kit.packHt))} HT</p>${kit.extras.length ? `<p>À ajouter à l'unité :</p><ul>${kit.extras.map((l) => `<li>${l.qte} × ${esc(l.nom)}${l.sansPrix ? ' — sans prix de vente' : ` · ${esc(eur(l.totalHt))} HT`}</li>`).join('')}</ul>` : '<p>Le pack couvre toute la demande.</p>'}${kit.bonus.length ? `<p>En plus dans le pack :</p><ul>${kit.bonus.map((b) => `<li>${b.qte} × ${esc(b.nom)}</li>`).join('')}</ul>` : ''}${res.economie != null ? `<p><b>${res.economie > 0 ? `Économie ${esc(eur(res.economie))} HT` : `Le pack coûte ${esc(eur(-res.economie))} HT de plus`}${res.economiePct != null && res.economie > 0 ? ` (${esc(pct(res.economiePct))})` : ''}</b></p>` : ''}${kit.incertains.length ? `<div class="aide-warn">${kit.incertains.map((i) => `Correspondance incertaine pour « ${esc(i.texte)} » : ${esc(i.retenu)}${i.autres.length ? ` (aussi ${esc(i.autres.join(', '))})` : ''}`).join('<br>')}</div>` : ''}${kit.nonApparies.length ? `<div class="aide-warn">Lignes du pack non reconnues : ${esc(kit.nonApparies.join(' · '))}</div>` : ''}<div class="aide-actions"><button type="button" class="btn ${reco === 'kit' ? 'btn-primary' : 'btn-secondary'}" data-ajouter="kit">Ajouter au devis</button></div></article>`
            : `<article class="aide-card"><h4>Pack + compléments</h4><p>Aucun pack de cette marque n'a de contenu exploitable. Complétez « Contenu du pack » dans la fiche produit pour les comparer.</p></article>`;
        const vides = res.packsVides.length ? `<details class="aide-note"><summary>${res.packsVides.length} pack${res.packsVides.length > 1 ? 's' : ''} sans contenu, exclu${res.packsVides.length > 1 ? 's' : ''} du calcul</summary><ul>${res.packsVides.map((p) => `<li>${esc(p.nom)}</li>`).join('')}</ul></details>` : '<p class="aide-note">Tous les packs de la marque ont un contenu renseigné.</p>';
        return `${res.avertissement ? `<div class="aide-warn">${esc(res.avertissement)}</div>` : ''}<p class="aide-note">Comparaison ${esc(tauxTxt)}. Les prix d'achat ne sont pas utilisés. ${ouvert ? 'Les quantités s’ajoutent au devis en cours.' : 'Ouvrez un devis pour ajouter la solution.'}</p><div class="aide-comp">${carteInd}${carteKit}</div>${vides}`;
    }
    outil.addEventListener('input', (e) => {
        if (e.target.id === 'aide-search') rendu();
        const saisie = e.target.dataset && e.target.dataset.saisie;
        if (saisie) {
            const b = besoins.find((x) => x.id === saisie);
            if (b) b.qte = Math.max(1, Math.round(parseFloat(e.target.value) || 1));
            renduComparaisonSeule();
        }
    });
    outil.addEventListener('change', (e) => {
        if (e.target.id !== 'aide-marque') return;
        marque = e.target.value;
        besoins = [];
        $('aide-search').value = '';
        rendu();
    });
    function renduComparaisonSeule() {
        const prods = getProduits() || {};
        const res = besoins.length ? calculerAide(prods, { marque, besoins, taux: tauxDevis() }) : null;
        $('aide-comparaison').innerHTML = res ? htmlComparaison(res, devisOuvert()) : '';
        $('aide-besoins').querySelectorAll('[data-saisie]').forEach((input) => {
            const b = besoins.find((x) => x.id === input.dataset.saisie);
            if (b && document.activeElement !== input) input.value = b.qte;
        });
    }
    outil.addEventListener('click', (e) => {
        const ajout = e.target.closest('[data-ajout]');
        if (ajout) {
            const id = ajout.dataset.ajout;
            const b = besoins.find((x) => x.id === id);
            if (b) b.qte += 1; else besoins.push({ id, qte: 1 });
            rendu();
            return;
        }
        const q = e.target.closest('[data-q]');
        if (q) {
            const b = besoins.find((x) => x.id === q.dataset.id);
            if (!b) return;
            b.qte = Math.max(1, b.qte + Number(q.dataset.q));
            rendu();
            return;
        }
        const ret = e.target.closest('[data-retirer]');
        if (ret) { besoins = besoins.filter((x) => x.id !== ret.dataset.retirer); rendu(); return; }
        const add = e.target.closest('[data-ajouter]');
        if (!add) return;
        if (!devisOuvert()) { toast('Ouvrez un devis pour ajouter ces lignes.', 'err'); return; }
        const res = calculerAide(getProduits(), { marque, besoins, taux: tauxDevis() });
        const items = add.dataset.ajouter === 'kit' && res.kit
            ? [{ id: res.kit.packId, qte: 1 }, ...res.kit.extras.filter((l) => !l.sansPrix).map((l) => ({ id: l.id, qte: l.qte }))]
            : res.individuel.lignes.filter((l) => !l.sansPrix).map((l) => ({ id: l.id, qte: l.qte }));
        if (!items.length) { toast('Rien à ajouter : aucun prix de vente.', 'err'); return; }
        ajouterLignes(items);
        if (document.getElementById('devis-editeur') && !document.getElementById('devis-editeur').hidden) placer('inline');
    });
    document.getElementById('btn-aide-devis')?.addEventListener('click', () => { placer('inline'); rendu(); });
    document.getElementById('aide-fermer')?.addEventListener('click', () => placer('tab'));
    document.querySelector('.tabs')?.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tab]');
        if (b && b.dataset.tab === 'panel-aide') { placer('tab'); rendu(); }
    });
    const tva = document.getElementById('dv-tva');
    if (tva) tva.addEventListener('change', rendu);
    rendu();
    return { ranger() { placer('tab'); } };
}
