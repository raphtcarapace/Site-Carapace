// Outil admin : conversion TTC des prix Ajax, retrait des Somfy filaires, import du JSON.
import { writeBatch, doc, collection, Timestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ajaxAConvertir, filairesASupprimer, nouveauxAImporter, champsImport } from "./catalogue-plan.js";

const $ = (id) => document.getElementById(id);

function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function eur(n) {
    return Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export function initCatalogueMaj({ db, toast, getProduits, apres }) {
    let fichier = null;
    let chargement = null;
    let enCours = false;
    let dernier = "";

    function chargerFichier() {
        if (!chargement) {
            chargement = fetch("assets/data/produits-sans-fil.json").then((r) => {
                if (!r.ok) throw new Error("Fichier du catalogue introuvable (" + r.status + ")");
                return r.json();
            }).catch((e) => { chargement = null; throw e; });
        }
        return chargement;
    }

    function timestampDe(iso) {
        const d = new Date(iso);
        return isNaN(d.getTime()) ? Timestamp.now() : Timestamp.fromDate(d);
    }

    function planActuel() {
        const produits = getProduits() || {};
        const ajax = ajaxAConvertir(produits);
        const filaires = filairesASupprimer(produits);
        const imports = nouveauxAImporter(produits, fichier || []);
        return { ajax, filaires, imports };
    }

    function coches() {
        return [...document.querySelectorAll("#maj-checklist input[data-import]")]
            .filter((el) => el.checked)
            .map((el) => Number(el.dataset.import));
    }

    function majBouton(plan) {
        const btn = $("maj-appliquer");
        if (!btn) return;
        const n = coches().length;
        const reste = plan.ajax.length + plan.filaires.length + n;
        btn.disabled = enCours || reste === 0;
        btn.textContent = enCours ? "Application en cours..." : "Appliquer";
    }

    function rendu(plan) {
        const resume = $("maj-resume");
        const liste = $("maj-checklist");
        const resultat = $("maj-resultat");
        if (!resume || !liste) return;
        const rien = plan.ajax.length === 0 && plan.filaires.length === 0 && plan.imports.length === 0;
        if (rien) {
            resume.innerHTML = `<p class="maj-ok">Déjà appliqué. Aucun prix Ajax à convertir, aucun produit filaire à retirer, aucun nouveau produit à importer.</p>`;
            liste.hidden = true;
            liste.innerHTML = "";
        } else {
            const exemple = plan.ajax.find((a) => /hub 2 plus/i.test(a.nom));
            const ex = exemple ? ` Exemple : ${esc(exemple.nom)}, ${esc(eur(exemple.avant))} vers ${esc(eur(exemple.apres))}.` : "";
            const nomsFil = plan.filaires.length
                ? `<ul class="maj-noms">${plan.filaires.map((f) => `<li>${esc(f.nom)}${f.prix != null ? ` (${esc(eur(f.prix))})` : ""}</li>`).join("")}</ul>`
                : `<p class="hint">Aucun.</p>`;
            resume.innerHTML = `
                <div class="maj-block"><strong>${plan.ajax.length}</strong> prix Ajax à convertir en TTC (prix actuel × 1,2, une seule fois).${ex}</div>
                <div class="maj-block"><strong>${plan.filaires.length}</strong> produit${plan.filaires.length > 1 ? "s" : ""} filaire${plan.filaires.length > 1 ? "s" : ""} à retirer${nomsFil}</div>
                <div class="maj-block"><strong>${plan.imports.length}</strong> nouveau${plan.imports.length > 1 ? "x" : ""} produit${plan.imports.length > 1 ? "s" : ""} à importer. Décochez ceux que vous ne voulez pas ajouter.</div>`;
            liste.hidden = plan.imports.length === 0;
            liste.innerHTML = plan.imports.length ? `
                <label class="maj-row maj-all"><input type="checkbox" id="maj-tout" checked> <span>Tout sélectionner <small>${plan.imports.length} produits</small></span></label>
                ${plan.imports.map(({ index, item }) => {
                    const prix = item.prix === "" || item.prix == null ? "Sur devis" : eur(item.prix);
                    const marque = item.marque === "yale" ? "Yale" : (item.marque || "");
                    return `<label class="maj-row"><input type="checkbox" data-import="${index}" checked> <span><b>${esc(item.nom)}</b><small>${esc(marque)} ${item.categorie ? "· " + esc(item.categorie) : ""}${item.est_pack ? " · Pack" : ""}</small></span><em class="maj-prix">${esc(prix)}</em></label>`;
                }).join("")}` : "";
        }
        if (resultat) {
            resultat.hidden = !dernier;
            resultat.textContent = dernier;
        }
        majBouton(plan);
    }

    async function rafraichir() {
        const intro = $("maj-intro");
        try {
            if (intro) intro.textContent = "Comparaison avec le catalogue en ligne...";
            fichier = await chargerFichier();
            if (!Array.isArray(fichier)) throw new Error("Le fichier produits n'est pas une liste.");
            if (intro) intro.textContent = "Matériel sans fil uniquement. Les produits déjà présents (même nom, même marque) sont ignorés.";
            rendu(planActuel());
        } catch (e) {
            if (intro) intro.textContent = "Impossible de préparer la mise à jour.";
            const resume = $("maj-resume");
            if (resume) resume.innerHTML = `<p class="maj-err">${esc(e.message || "Erreur")}</p>`;
            const btn = $("maj-appliquer");
            if (btn) btn.disabled = true;
        }
    }

    async function appliquer() {
        if (enCours) return;
        const plan = planActuel();
        const voulus = new Set(coches());
        const imports = plan.imports.filter(({ index }) => voulus.has(index));
        const total = plan.ajax.length + plan.filaires.length + imports.length;
        if (!total) return;
        const message = [
            "Appliquer la mise à jour du catalogue ?",
            "",
            plan.ajax.length + " prix Ajax convertis en TTC",
            plan.filaires.length + " produit(s) filaire(s) supprimé(s)" + (plan.filaires.length ? " : " + plan.filaires.map((f) => f.nom).join(", ") : ""),
            imports.length + " nouveau(x) produit(s) importé(s)",
            "",
            "Cette action modifie le catalogue Firestore."
        ].join("\n");
        if (!confirm(message)) return;
        enCours = true;
        majBouton(plan);
        const ops = [];
        plan.ajax.forEach((a) => ops.push({ type: "update", id: a.id, data: { prix: a.apres, prix_ttc_migre: true } }));
        plan.filaires.forEach((f) => ops.push({ type: "delete", id: f.id }));
        imports.forEach(({ item }) => {
            const data = champsImport(item);
            data.date_ajout = timestampDe(item.date_ajout);
            ops.push({ type: "set", data });
        });
        try {
            const TAILLE = 450;
            for (let i = 0; i < ops.length; i += TAILLE) {
                const batch = writeBatch(db);
                ops.slice(i, i + TAILLE).forEach((op) => {
                    if (op.type === "update") batch.update(doc(db, "produits", op.id), op.data);
                    else if (op.type === "delete") batch.delete(doc(db, "produits", op.id));
                    else batch.set(doc(collection(db, "produits")), op.data);
                });
                await batch.commit();
            }
            dernier = `Terminé : ${plan.ajax.length} prix Ajax passé${plan.ajax.length > 1 ? "s" : ""} en TTC, ${plan.filaires.length} produit${plan.filaires.length > 1 ? "s" : ""} filaire${plan.filaires.length > 1 ? "s" : ""} supprimé${plan.filaires.length > 1 ? "s" : ""}, ${imports.length} produit${imports.length > 1 ? "s" : ""} importé${imports.length > 1 ? "s" : ""}.`;
            toast(dernier);
            if (typeof apres === "function") await apres();
            else await rafraichir();
        } catch (e) {
            console.error(e);
            dernier = "Erreur pendant l'écriture : " + (e.message || "opération refusée");
            const resultat = $("maj-resultat");
            if (resultat) { resultat.hidden = false; resultat.textContent = dernier; }
            toast(dernier, "err");
        } finally {
            enCours = false;
            majBouton(planActuel());
        }
    }

    $("maj-appliquer")?.addEventListener("click", appliquer);
    $("maj-checklist")?.addEventListener("change", (e) => {
        if (e.target.id === "maj-tout") {
            document.querySelectorAll("#maj-checklist input[data-import]").forEach((el) => { el.checked = e.target.checked; });
        } else if (e.target.matches("input[data-import]")) {
            const tous = [...document.querySelectorAll("#maj-checklist input[data-import]")];
            const maitre = $("maj-tout");
            if (maitre) maitre.checked = tous.every((el) => el.checked);
        }
        majBouton(planActuel());
    });

    return { rafraichir };
}
