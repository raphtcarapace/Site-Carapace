// Recommandations du configurateur : chaque réponse ne propose que des produits
// qui correspondent, à partir du catalogue Firestore (noms et catégories).
(function (root) {
  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/®/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function text(p) {
    return norm([p.nom, p.categorie].filter(Boolean).join(" "));
  }
  function prix(p) {
    const n = parseFloat(p && p.prix);
    return isFinite(n) && n > 0 ? n : 0;
  }
  function aPrix(p) { return prix(p) > 0; }

  function isLock(p) {
    const t = text(p);
    if (/meuble|coffre|judas/.test(t)) return false;
    return /serrure connectee|linus|keyless/.test(t);
  }
  function isOutdoor(p) {
    const t = text(p);
    return /outdoor|exterieur|street|highmount|facade|jardin/.test(t);
  }

  function choisir(liste, score, deja) {
    let gagnant = null;
    let meilleur = 0;
    liste.forEach((p) => {
      if (!p || !p.nom || (deja && deja.has(p.id))) return;
      if (isLock(p) && !score.lockOk) return;
      const s = score.fn(p);
      if (s > meilleur) { meilleur = s; gagnant = p; }
    });
    return gagnant;
  }

  function bonusPrix(p, base) {
    return base + (aPrix(p) ? 100 : 0);
  }

  function lignesPour(produits, choix) {
    const liste = (Array.isArray(produits) ? produits : Object.entries(produits || {}).map(([id, p]) => ({ id, ...p })))
      .filter((p) => p && p.nom);
    const options = new Set(choix.options || []);
    const logement = choix.logement || "appartement";
    const objectif = choix.objectif === "complet" || choix.objectif === "domotique" ? (choix.objectif === "domotique" ? "intrusion" : "video") : (choix.objectif || "intrusion");
    const brand = choix.marque === "somfy" ? "somfy" : (objectif === "acces" && !choix.marque ? "yale" : (choix.marque || "ajax"));
    const cameras = objectif === "video" || options.has("cameras");
    const locks = objectif === "acces" || options.has("acces");
    const pets = options.has("animaux");
    const fire = options.has("incendie");
    const leak = options.has("fuite");
    const alarmGoal = objectif === "intrusion" || objectif === "video";
    const alarm = alarmGoal || pets || cameras || options.has("exterieur") || fire || leak;
    const outdoor = (alarmGoal && (logement === "maison" || options.has("exterieur"))) || options.has("exterieur");
    const deja = new Set();
    const out = [];
    let base = null;

    function ajouter(role, p, pourquoi, qte) {
      if (!p) return;
      deja.add(p.id);
      out.push({
        id: p.id,
        nom: p.nom,
        marque: p.marque,
        prix: p.prix,
        image: p.image,
        surDevis: !aPrix(p),
        qte: qte || 1,
        pourquoi,
        role
      });
    }

    const deMarque = (m) => liste.filter((p) => p.marque === m);
    const marqueAlarm = brand === "yale" ? "ajax" : brand;
    function prendre(marque, fn, autreMarque) {
      const premier = choisir(marque ? deMarque(marque) : liste, { fn }, deja);
      if (premier || !autreMarque) return premier;
      return choisir(liste.filter((p) => p.marque !== "yale" || fn.lockOk), { fn }, deja);
    }

    if (alarm) {
      base = prendre(marqueAlarm, (p) => {
          const t = text(p);
          if (p.marque !== marqueAlarm) return -1;
          if (/fibra|hybrid|nvr|waterstop|socket|leak|fireprotect|fumee|fum |prise |zigbee|tahoma|domotique/.test(t)) return -1;
          let s = 0;
          if (marqueAlarm === "ajax") {
            if (/\bhub\b/.test(t) && !/\brex\b/.test(t)) s = 50;
            else if (/starterkit|starter kit/.test(t)) s = 20;
            else return -1;
            if (/hub 2/.test(t) && logement !== "appartement") s += 18;
            if (/hub \(2g\)|hub 2g/.test(t) && logement === "appartement") s += 14;
            if (/superior/.test(t)) s -= 12;
          } else if (marqueAlarm === "somfy") {
            if (!/home alarm/.test(t)) return -1;
            s = 40;
            if (/video/.test(t)) s += cameras ? 35 : -30;
            if (/starter/.test(t) && !cameras) s += 24;
            if (/essential/.test(t) && logement === "appartement") s += 8;
            if (/advanced/.test(t) && logement !== "appartement") s += 8;
          } else return -1;
          return bonusPrix(p, s);
      });
      const pack = base && (base.est_pack || /starterkit|starter kit|home alarm/.test(text(base)));
      ajouter("centrale", base, pack && marqueAlarm === "somfy"
        ? "Centrale, sirène et télécommande sont dans ce pack de départ."
        : (pack ? "Kit de départ avec la centrale. On complète ensuite selon vos réponses." : "Centrale sans fil indispensable pour piloter les détecteurs."), 1);

      const clavier = prendre(marqueAlarm, (p) => {
          if (pack && marqueAlarm === "somfy") return -1;
          const t = text(p);
          if (isLock(p) || isOutdoor(p)) return -1;
          let s = 0;
          if (/keypad|clavier/.test(t) && !/linus|serrure/.test(t)) s = 40;
          else if (/spacecontrol|telecommande|badge/.test(t) || (norm(p.categorie || "").includes("bouton") && /button|spacecontrol/.test(t))) s = 24;
          else return -1;
          if (/superior/.test(t)) s -= 6;
          return bonusPrix(p, s);
      });
      ajouter("commande", clavier, /keypad|clavier/.test(text(clavier || {}))
        ? "Clavier pour armer et désarmer sans ouvrir l'application."
        : "Télécommande pour armer et désarmer depuis l'entrée.", 1);

      const mouvement = prendre(marqueAlarm, (p) => {
          const t = text(p);
          if (isLock(p) || isOutdoor(p)) return -1;
          if (/ouverture|doorprotect|intellitag|siren|hub|keypad|clavier|fire|fum|leak|fuite|camera|caméra/.test(t)) return -1;
          if (!/motion|mouvement|combiprotect/.test(t)) return -1;
          let s = 20;
          if (pets) {
            if (/animaux|animal|pet|motionprotect plus/.test(t)) s = 60;
            else if (/combiprotect/.test(t)) s = 48;
            else if (/motioncam/.test(t)) s = 36;
            else return -1;
          } else if (/motioncam/.test(t)) s = 18;
          if (pack && !pets) return -1;
          return bonusPrix(p, s);
      });
      const qteMouv = logement === "pro" ? 2 : 1;
      ajouter("mouvement", mouvement, pets
        ? "Détecteur de mouvement qui ignore les animaux. Une serrure ne répond pas à ce besoin."
        : (logement === "pro"
          ? "Deux détecteurs de mouvement pour couvrir un local professionnel."
          : "Détecteur de mouvement pour les pièces de vie."), qteMouv);

      const contact = prendre(marqueAlarm, (p) => {
          const t = text(p);
          if (isLock(p) || /motion|mouvement|siren|hub|camera|caméra/.test(t)) return -1;
          if (!/doorprotect|ouverture|intellitag/.test(t)) return -1;
          if (isOutdoor(p) && !/intellitag/.test(t)) return -1;
          let s = 30;
          if (/pack de 5|lot de/.test(t)) s -= 20;
          return bonusPrix(p, s);
      });
      const qteContact = pack
        ? (logement === "appartement" ? 1 : logement === "maison" ? 3 : 4)
        : (logement === "appartement" ? 2 : logement === "maison" ? 4 : 5);
      ajouter("ouverture", contact, logement === "appartement"
        ? "Contacts d'ouverture pour la porte d'entrée et une fenêtre."
        : (logement === "maison"
          ? "Plus de contacts d'ouverture : une maison a davantage de portes et de fenêtres qu'un appartement."
          : "Contacts d'ouverture pour les accès d'un local professionnel."), qteContact);

      if (!outdoor) {
        const sireneInt = prendre(marqueAlarm, (p) => {
            const t = text(p);
            if (!/siren|sirene/.test(t) || isOutdoor(p)) return -1;
            return bonusPrix(p, 30);
        });
        if (!pack) ajouter("sirene", sireneInt, "Sirène intérieure pour alerter dès l'intrusion.", 1);
      }
    }

    if (outdoor && alarm) {
      const extMot = prendre(marqueAlarm, (p) => {
          const t = text(p);
          if (isLock(p) || !isOutdoor(p)) return -1;
          if (!/motion|mouvement|curtain|ouverture/.test(t)) return -1;
          const s = /motion|mouvement|curtain/.test(t) ? 40 : 22;
          return bonusPrix(p, s);
      });
      ajouter("exterieur", extMot, "Détecteur extérieur sans fil pour le jardin, la façade ou l'allée.", 1);

      const sireneExt = prendre(marqueAlarm, (p) => {
          const t = text(p);
          if (!/siren|sirene/.test(t) || !isOutdoor(p)) return -1;
          if (/interieur|home siren|homesiren/.test(t)) return -1;
          return bonusPrix(p, 34);
      });
      ajouter("sirene-ext", sireneExt, "Sirène extérieure pour dissuader avant l'effraction.", 1);
    }

    const baseAvecCamera = base && /video|camera/.test(text(base));
    if (cameras && !baseAvecCamera) {
      const marqueCam = objectif === "acces" ? "yale" : marqueAlarm;
      const interieure = prendre(marqueCam, (p) => {
          const t = text(p);
          if (isLock(p) || /motioncam|curtaincam/.test(t)) return -1;
          if (isOutdoor(p)) return -1;
          if (!/indoorcam|camera interieure|indoor camera|camera/.test(t)) return -1;
          return bonusPrix(p, 36);
      }, true);
      ajouter("camera", interieure, "Caméra intérieure, parce que vous voulez voir à distance.", 1);

      if (outdoor || logement === "maison") {
        const exterieure = prendre(marqueCam, (p) => {
            const t = text(p);
            if (isLock(p) || /motioncam|curtain/.test(t)) return -1;
            if (!(/camera/.test(t) && isOutdoor(p))) return -1;
            return bonusPrix(p, 36);
        }, true);
        ajouter("camera-ext", exterieure, "Caméra extérieure sans fil pour le jardin ou la façade.", 1);
      }
    }

    if (locks) {
      const serrure = choisir(liste.filter((p) => p.marque === "yale"), {
        lockOk: true,
        fn: (p) => {
          if (!isLock(p)) return -1;
          const t = text(p);
          let s = 40;
          if (/wi-fi|wifi/.test(t)) s += 16;
          if (/clavier a code/.test(t) && /linus/.test(t)) s += 22;
          if (/empreinte/.test(t)) s -= 4;
          if (/batterie|cylindre ajustable|dot /.test(t) && !/pack/.test(t)) s -= 30;
          return bonusPrix(p, s);
        }
      }, deja);
      const avecClavier = serrure && /clavier/.test(text(serrure));
      ajouter("serrure", serrure, avecClavier
        ? "Serrure connectée avec clavier, parce que vous avez demandé un accès sans clé."
        : "Serrure connectée, uniquement parce que vous avez demandé un accès sans clé.", 1);
      if (serrure && !avecClavier) {
        const clavierSerrure = choisir(liste.filter((p) => p.marque === "yale"), {
          lockOk: true,
          fn: (p) => {
            const t = text(p);
            if (!/clavier a code|clavier connecte/.test(t) || /alarme/.test(t)) return -1;
            return bonusPrix(p, 30);
          }
        }, deja);
        ajouter("clavier-serrure", clavierSerrure, "Clavier pour ouvrir sans clé, en complément de la serrure.", 1);
      }
    }

    if (fire) {
      const fumee = prendre(marqueAlarm, (p) => {
          const t = text(p);
          if (!/fireprotect|fumee|smoke/.test(t)) return -1;
          if (/\(co\)/.test(t) && !/smoke|heat/.test(t)) return -1;
          let s = /fireprotect|fumee|smoke/.test(t) ? 24 : 0;
          if (!s) return -1;
          if (/smoke|fumee/.test(t)) s += 20;
          if (/\(heat\)/.test(t) && !/smoke/.test(t)) s -= 16;
          if (/\(co\)/.test(t) && !/smoke/.test(t)) s -= 16;
          return bonusPrix(p, s);
      }, true);
      const qteF = logement === "appartement" ? 1 : 2;
      ajouter("incendie", fumee, logement === "appartement"
        ? "Détecteur de fumée, parce que vous l'avez demandé."
        : "Deux détecteurs de fumée pour une maison ou un local.", qteF);
    }

    if (leak) {
      const fuite = prendre(marqueAlarm, (p) => {
          const t = text(p);
          if (!/leak|fuite/.test(t)) return -1;
          if (/waterstop|vanne/.test(t)) return -1;
          return bonusPrix(p, 40);
      }, true);
      ajouter("fuite", fuite, "Détecteur de fuite d'eau, parce que vous l'avez demandé.", 1);
    }

    if (!out.length && liste.length) {
      const repli = choisir(liste, {
        fn: (p) => {
          if (isLock(p) && !locks) return -1;
          if (p.marque !== marqueAlarm && p.marque !== brand) return -1;
          return bonusPrix(p, p.est_pack ? 20 : 8);
        }
      }, deja);
      ajouter("repli", repli, "Base du catalogue la plus proche de votre demande.", 1);
    }

    return {
      logement,
      objectif,
      marque: marqueAlarm,
      locks,
      cameras,
      pets,
      outdoor,
      fire,
      leak,
      alarm,
      lignes: out
    };
  }

  root.CarapaceConfigurateur = { recommander: lignesPour, norm };
})(typeof window !== "undefined" ? window : globalThis);
