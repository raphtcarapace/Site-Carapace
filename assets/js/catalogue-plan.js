// Préparation de la mise à jour du catalogue (sans Firebase, testable telle quelle).
// Les produits Somfy du fichier n'ont pas de catégorie : le site public les range
// déjà en « Packs » ou « À la carte » grâce à est_pack, donc on laisse categorie vide.

export function normaliserNom(s) {
    return String(s ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/®/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

export function cleProduit(marque, nom) {
    return String(marque || "").toLowerCase().trim() + "|" + normaliserNom(nom);
}

export function prixNombre(v) {
    if (v === "" || v == null) return null;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    if (!isFinite(n)) return null;
    return Math.round(n * 100) / 100;
}

// Visiophone V350 Connect et Outdoor Camera 2 (filaires).
export function estFilaireSomfy(p) {
    if (String(p?.marque || "").toLowerCase() !== "somfy") return false;
    const n = normaliserNom(p.nom);
    if (n.includes("outdoor camera 2")) return true;
    return n.includes("v350") && n.includes("connect");
}

export function ajaxAConvertir(produits) {
    return Object.entries(produits || {}).flatMap(([id, p]) => {
        if (String(p?.marque || "").toLowerCase() !== "ajax") return [];
        if (p.prix_ttc_migre === true) return [];
        const ht = prixNombre(p.prix);
        if (ht == null || ht <= 0) return [];
        return [{ id, nom: p.nom || "", avant: ht, apres: Math.round(ht * 120) / 100 }];
    });
}

export function filairesASupprimer(produits) {
    return Object.entries(produits || {}).flatMap(([id, p]) => {
        if (!estFilaireSomfy(p)) return [];
        return [{ id, nom: p.nom || "", prix: prixNombre(p.prix) }];
    });
}

export function nouveauxAImporter(produits, fichier) {
    const deja = new Set(Object.values(produits || {}).map((p) => cleProduit(p.marque, p.nom)));
    const vus = new Set();
    const out = [];
    (fichier || []).forEach((item, index) => {
        const cle = cleProduit(item?.marque, item?.nom);
        if (!item?.nom || deja.has(cle) || vus.has(cle)) return;
        vus.add(cle);
        out.push({ index, item });
    });
    return out;
}

// Champs Firestore d'un produit importé. date_ajout est ajouté à part (Timestamp).
export function champsImport(item) {
    const prix = prixNombre(item.prix);
    const prixHt = prixNombre(item.prix_ht);
    const data = {
        marque: String(item.marque || "").toLowerCase(),
        nom: String(item.nom || "").trim(),
        categorie: item.categorie ? String(item.categorie) : null,
        description: String(item.description || ""),
        description_longue: String(item.description_longue || ""),
        prix: prix != null && prix > 0 ? prix : "",
        prix_ht: prixHt != null ? prixHt : "",
        image: String(item.image || ""),
        images_secondaires: Array.isArray(item.images_secondaires) ? item.images_secondaires.filter((s) => typeof s === "string" && s) : [],
        est_pack: !!item.est_pack,
        a_la_une: !!item.a_la_une,
        est_a_la_une: !!item.est_a_la_une,
        featured: !!item.featured,
        reference: String(item.reference || ""),
        source_url: String(item.source_url || ""),
        sans_fil: item.sans_fil !== false
    };
    // Le fichier Ajax est déjà en TTC. Le drapeau évite un second passage × 1,2.
    if (data.marque === "ajax") data.prix_ttc_migre = true;
    return data;
}
