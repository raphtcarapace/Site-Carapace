// =====================================================================
//  Informations de l'entreprise affichées sur les DEVIS (PDF)
//  👉 Remplacez chaque [À COMPLÉTER] par vos vraies informations
//     (elles figurent sur votre extrait Kbis / avis de situation INSEE).
// =====================================================================
export const ENTREPRISE = {
    nom: "Carapace",
    slogan: "La protection de vos espaces",
    raison_sociale: "[À COMPLÉTER : raison sociale ou nom et prénom]",
    forme_juridique: "[À COMPLÉTER : ex. EI, micro-entreprise, SAS]",
    adresse: "[À COMPLÉTER : adresse]",
    code_postal_ville: "[À COMPLÉTER : code postal et ville]",
    telephone: "[À COMPLÉTER : téléphone]",
    email: "[À COMPLÉTER : e-mail]",
    siret: "[À COMPLÉTER : SIRET]",
    rcs_rm: "[À COMPLÉTER : RCS / RM, le cas échéant]",
    tva_intra: "[À COMPLÉTER : n° TVA intracommunautaire, ou laisser vide si TVA non applicable]",
    assurance: "[À COMPLÉTER : assurance professionnelle (assureur, n° de contrat, zone couverte)]",
    iban: "", // facultatif : IBAN pour le règlement de l'acompte

    // Valeurs proposées par défaut sur un nouveau devis (modifiables devis par devis)
    validite_jours: 30,
    tva_defaut: 20,          // 20, 10, 5.5 ou 0
    tva_franchise_defaut: false, // true si vous êtes en franchise de TVA (art. 293 B du CGI)
    acompte_defaut: 30,      // % d'acompte demandé à la signature (0 = aucun)
    conditions_defaut:
        "Devis valable jusqu'à la date de validité indiquée.\n" +
        "Acompte à la signature, solde à la fin de l'installation.\n" +
        "Modes de règlement : [À COMPLÉTER : virement, chèque, espèces...].\n" +
        "Garantie : [À COMPLÉTER : durée de garantie du matériel et de la pose].\n" +
        "En cas de retard de paiement (clients professionnels) : pénalités au taux légal et indemnité forfaitaire de 40 € pour frais de recouvrement."
};
