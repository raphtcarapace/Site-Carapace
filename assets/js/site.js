/* =========================================================
   CARAPACE — Interface du site (navigation, catalogue,
   configurateur, recherche, formulaire).
   Les données (produits, demandes) viennent de Firebase :
   voir assets/js/firebase-site.js
   ========================================================= */
(function () {
  'use strict';

  /* ---------- Utilitaires ---------- */
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function safeUrl(u) {
    const s = String(u || '').trim();
    if (!s || /^\s*(javascript|data:text)/i.test(s)) return '';
    return s;
  }
  const priceFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  function fmtPrice(p) {
    const n = parseFloat(p);
    return isFinite(n) && n > 0 ? priceFmt.format(n) : 'Sur devis';
  }
  const BRAND_LABEL = { ajax: 'Gamme AJAX', somfy: 'Gamme SOMFY', yale: 'Yale Home' };
  const BRAND_SHORT = { ajax: 'Ajax', somfy: 'Somfy', yale: 'Yale Home' };
  const normalize = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const stripTags = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  let toastTimer;
  function toast(msg, type) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast show' + (type === 'error' ? ' error' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
  }

  /* ---------- État ---------- */
  const state = {
    products: {},          // id -> produit (données Firestore)
    loaded: false,
    error: false,
    pendingDetail: null,
    currentPage: 'home',
    previousPage: 'home',
    filters: { ajax: { q: '', cat: 'all', sort: 'default' }, somfy: { q: '', cat: 'all', sort: 'default' }, yale: { q: '', cat: 'all', sort: 'default' } }
  };
  const list = () => Object.entries(state.products).map(([id, p]) => ({ id, ...p }));

  /* ---------- Navigation (pages) ---------- */
  const PAGES = ['home', 'ajax', 'somfy', 'yale', 'contact', 'detail'];
  const HOME_ANCHORS = ['accueil', 'configurateur', 'faq', 'methode', 'avis', 'zone'];
  const header = $('#site-header');

  function setActiveNav(pageId) {
    $$('.main-nav a, .mobile-menu a.m-link').forEach(a => a.classList.remove('active'));
    $$(`.main-nav a[data-page="${pageId}"]:not([data-scroll]), .mobile-menu a.m-link[data-page="${pageId}"]:not([data-scroll])`).forEach(a => a.classList.add('active'));
  }

  function showPage(pageId, opts = {}) {
    if (!PAGES.includes(pageId)) pageId = 'home';
    if (pageId !== 'detail' && pageId !== state.currentPage) state.previousPage = pageId;
    if (pageId === 'detail' && state.currentPage !== 'detail') state.previousPage = state.currentPage;
    const changed = state.currentPage !== pageId;
    state.currentPage = pageId;
    if (changed || !$('#page-' + pageId).classList.contains('active')) {
      $$('.page-section').forEach(el => el.classList.remove('active'));
      $('#page-' + pageId).classList.add('active');
    }
    setActiveNav(pageId);
    header.classList.toggle('is-light', pageId === 'detail');
    closeMenu();
    if (opts.scroll) {
      const target = document.getElementById(opts.scroll);
      if (target) setTimeout(() => target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }), changed ? 60 : 0);
    } else if (!opts.keepScroll) {
      window.scrollTo({ top: 0, behavior: changed ? 'auto' : (reduceMotion ? 'auto' : 'smooth') });
    }
    if (changed) setTimeout(observeReveals, 30);
    updateTitle();
  }

  function updateTitle() {
    const base = 'Carapace — La protection de vos espaces';
    const titles = { ajax: 'Alarmes Ajax', somfy: 'Somfy — maison connectée', yale: 'Yale Home — serrures connectées', contact: 'Contact & devis gratuit' };
    if (state.currentPage === 'detail') {
      const n = $('#detail-titre').textContent; document.title = n + ' | Carapace';
    } else document.title = titles[state.currentPage] ? titles[state.currentPage] + ' | Carapace' : base;
  }

  function setHash(h) {
    const want = '#' + h;
    if (location.hash !== want) history.pushState(null, '', want);
  }

  function route() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!h || h === 'accueil') return showPage('home', h ? { scroll: 'accueil' } : {});
    if (h.startsWith('produit/')) {
      const id = h.slice(8);
      if (state.products[id]) return renderDetail(id);
      if (!state.loaded && !state.error) { state.pendingDetail = id; return; }
      return showPage('home');
    }
    if (PAGES.includes(h) && h !== 'detail') return showPage(h);
    if (HOME_ANCHORS.includes(h)) return showPage('home', { scroll: h });
    showPage('home');
  }
  window.addEventListener('popstate', route);

  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-page]');
    if (a) {
      e.preventDefault();
      const page = a.dataset.page, scroll = a.dataset.scroll;
      setHash(scroll || (page === 'home' ? 'accueil' : page));
      showPage(page, scroll ? { scroll } : (page === 'home' && a.classList.contains('brand') ? {} : {}));
      return;
    }
    const back = e.target.closest('[data-back]');
    if (back) { e.preventDefault(); retourMarque(); }
  });

  function retourMarque() {
    const p = state.previousPage && state.previousPage !== 'detail' ? state.previousPage : 'home';
    setHash(p === 'home' ? 'accueil' : p);
    showPage(p);
  }

  /* ---------- Header au scroll, CTA flottant ---------- */
  const sticky = $('#sticky-cta');
  function onScroll() {
    const y = window.scrollY;
    header.classList.toggle('is-solid', y > 30);
    sticky.classList.toggle('show', y > 640 && state.currentPage !== 'contact');
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  $('#to-top').addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));

  /* ---------- Menu mobile ---------- */
  const menu = $('#mobile-menu'), burger = $('#burger');
  function openMenu() { menu.classList.add('open'); menu.setAttribute('aria-hidden', 'false'); burger.setAttribute('aria-expanded', 'true'); document.body.classList.add('no-scroll'); }
  function closeMenu() { if (!menu.classList.contains('open')) return; menu.classList.remove('open'); menu.setAttribute('aria-hidden', 'true'); burger.setAttribute('aria-expanded', 'false'); document.body.classList.remove('no-scroll'); }
  burger.addEventListener('click', openMenu);
  menu.addEventListener('click', (e) => { if (e.target === menu || e.target.closest('[data-close-menu]')) closeMenu(); });

  /* ---------- Animations d'apparition ---------- */
  let io;
  function observeReveals() {
    const items = $$('.page-section.active .reveal:not(.in), .site-footer .reveal:not(.in)');
    if (!('IntersectionObserver' in window) || reduceMotion) { items.forEach(el => el.classList.add('in')); return; }
    if (!io) io = new IntersectionObserver((entries) => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    items.forEach(el => io.observe(el));
  }

  /* Compteurs animés (chiffres du bandeau) */
  function animateCounters() {
    $$('[data-count]').forEach(el => {
      const end = parseFloat(el.dataset.count), dec = parseInt(el.dataset.decimals || '0', 10), suf = el.dataset.suffix || '';
      if (reduceMotion) return;
      const t0 = performance.now(), dur = 1600;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = (end * e).toFixed(dec) + suf;
        if (k < 1) requestAnimationFrame(step); else el.textContent = end.toFixed(dec) + suf;
      };
      requestAnimationFrame(step);
    });
  }

  /* Halo lumineux qui suit la souris sur les cartes */
  document.addEventListener('pointermove', (e) => {
    const c = e.target.closest && e.target.closest('.spot');
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  /* ---------- Cartes produit ---------- */
  function productCard(p, opts = {}) {
    const img = safeUrl(p.image);
    const featured = p.a_la_une || p.est_a_la_une || p.featured;
    const badges = [];
    if (p.est_pack) badges.push('<span class="badge red">Pack</span>');
    if (opts.featuredTag) badges.push(`<span class="badge dark">${esc(opts.featuredTag)}</span>`);
    else if (featured) badges.push('<span class="badge dark">À la une</span>');
    const desc = p.description ? stripTags(p.description) : '';
    return `
      <button type="button" class="card spot product-card ${p.est_pack ? 'pack' : ''}" data-product="${esc(p.id)}" aria-label="${esc(p.nom)} — ${esc(fmtPrice(p.prix))}">
        <div class="p-media">
          <div class="p-badges">${badges.join('')}</div>
          ${img ? `<img src="${esc(img)}" alt="${esc(p.nom)}" loading="lazy" decoding="async">` : ''}
        </div>
        <div class="p-body">
          <div class="p-brand">${esc(BRAND_SHORT[p.marque] || p.marque || '')}${p.categorie ? ' · ' + esc(p.categorie) : ''}</div>
          <div class="p-title">${esc(p.nom)}</div>
          ${desc ? `<div class="p-desc">${esc(desc)}</div>` : '<div class="p-desc"></div>'}
          <div class="p-foot">
            <span class="p-price">${esc(fmtPrice(p.prix))}${isFinite(parseFloat(p.prix)) && parseFloat(p.prix) > 0 ? '<small>TTC</small>' : ''}</span>
            <span class="p-go" aria-hidden="true"><svg><use href="#i-arrow"/></svg></span>
          </div>
        </div>
      </button>`;
  }
  function skeletons(n) {
    return Array.from({ length: n }, () => '<div class="card product-card skeleton" aria-hidden="true"><div class="p-media"></div><div class="sk"></div><div class="sk w60"></div><div class="sk w40"></div></div>').join('');
  }
  function emptyState(title, text) {
    return `<div class="empty-state"><strong>${esc(title)}</strong>${esc(text)}<div style="margin-top:14px"><a href="#contact" data-page="contact" class="btn btn-primary btn-sm">Nous contacter</a></div></div>`;
  }

  document.addEventListener('click', (e) => {
    const card = e.target.closest('[data-product]');
    if (card) { e.preventDefault(); ouvrirDetailProduit(card.dataset.product); }
  });

  /* ---------- Produits phares (même logique que l'original) ---------- */
  function afficherProduitsPhares() {
    const container = $('#featured-products');
    if (!container) return;
    const produits = list()
      .filter(p => p && p.image && p.nom)
      .map(p => {
        const isFeatured = Boolean(p.a_la_une || p.est_a_la_une || p.featured);
        const score = (p.est_pack ? 5 : 0) + (isFeatured ? 20 : 0) + (p.marque === 'ajax' ? 4 : 0) + (p.marque === 'somfy' ? 3 : 0) + (p.marque === 'yale' ? 3 : 0) + (parseFloat(p.prix || 0) > 0 ? 1 : 0);
        return { ...p, isFeatured, score };
      })
      .sort((a, b) => b.score - a.score || parseFloat(b.prix || 0) - parseFloat(a.prix || 0));
    let selection = produits.filter(p => p.isFeatured).slice(0, 4);
    if (selection.length < 4) ['ajax', 'somfy', 'yale'].forEach(m => {
      const match = produits.find(p => p.marque === m && !selection.some(s => s.id === p.id));
      if (match && selection.length < 4) selection.push(match);
    });
    produits.forEach(p => { if (selection.length < 4 && !selection.some(s => s.id === p.id)) selection.push(p); });
    const labelParMarque = { ajax: 'Alarmes', somfy: 'Maison connectée', yale: 'Entrée intelligente' };
    if (!selection.length) { container.innerHTML = emptyState('Aucun produit phare disponible pour le moment.', ' Contactez-nous pour découvrir nos solutions.'); return; }
    container.innerHTML = selection.slice(0, 4).map(p => productCard(p, { featuredTag: p.isFeatured ? 'À la une' : (labelParMarque[p.marque] || 'Sécurité') })).join('');
  }

  /* ---------- Catalogue par marque (recherche, filtres, tri) ---------- */
  function toolbarHTML(brand, cats) {
    return `
      <label class="search-field"><span class="sr-only">Rechercher dans la gamme</span><svg><use href="#i-search"/></svg>
        <input type="search" data-f="q" placeholder="Rechercher un produit ${esc(BRAND_SHORT[brand])}…" autocomplete="off"></label>
      <select class="sort-select" data-f="sort" aria-label="Trier les produits">
        <option value="default">Tri : recommandé</option><option value="asc">Prix croissant</option><option value="desc">Prix décroissant</option><option value="az">Nom A → Z</option>
      </select>
      <span class="result-count" data-count-out></span>
      <div class="chips" role="tablist" aria-label="Catégories">${cats.map(c => `<button type="button" class="chip ${c.key === 'all' ? 'active' : ''}" data-cat="${esc(c.key)}">${esc(c.label)}<span class="count">${c.n}</span></button>`).join('')}</div>`;
  }

  function brandItems(brand) { return list().filter(p => p.marque === brand); }
  function catKey(p, brand) {
    if (brand === 'somfy') return p.est_pack ? '__packs' : '__carte';
    if (brand === 'ajax' && p.est_pack) return '__packs';
    return p.categorie && p.categorie !== '' ? p.categorie : (brand === 'ajax' ? 'Autres produits Ajax' : 'Autres produits Yale');
  }
  function buildCats(brand) {
    const items = brandItems(brand), counts = {};
    items.forEach(p => { const k = catKey(p, brand); counts[k] = (counts[k] || 0) + 1; });
    const label = k => k === '__packs' ? 'Packs' : k === '__carte' ? 'À la carte' : k;
    const keys = Object.keys(counts).sort((a, b) => (a === '__packs' ? -1 : b === '__packs' ? 1 : a.localeCompare(b, 'fr')));
    return [{ key: 'all', label: 'Tout', n: items.length }, ...keys.map(k => ({ key: k, label: label(k), n: counts[k] }))];
  }
  function applyFilters(brand) {
    const f = state.filters[brand], q = normalize(f.q).trim();
    let items = brandItems(brand).filter(p => {
      if (f.cat !== 'all' && catKey(p, brand) !== f.cat) return false;
      if (!q) return true;
      return normalize([p.nom, p.categorie, stripTags(p.description), stripTags(p.description_longue)].join(' ')).includes(q);
    });
    const num = p => parseFloat(p.prix) || 0;
    if (f.sort === 'asc') items.sort((a, b) => num(a) - num(b));
    else if (f.sort === 'desc') items.sort((a, b) => num(b) - num(a));
    else if (f.sort === 'az') items.sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr'));
    return items;
  }
  function groupHTML(title, items) {
    return `<section class="cat-block"><h2 class="cat-title">${esc(title)} <small>${items.length} produit${items.length > 1 ? 's' : ''}</small></h2><div class="products-grid">${items.map(p => productCard(p)).join('')}</div></section>`;
  }

  function renderBrand(brand) {
    const page = $('#page-' + brand); if (!page) return;
    const tb = page.querySelector('[data-toolbar]');
    if (!tb.dataset.ready && state.loaded) {
      tb.innerHTML = toolbarHTML(brand, buildCats(brand)); tb.dataset.ready = '1';
      tb.addEventListener('input', (e) => { if (e.target.dataset.f === 'q') { state.filters[brand].q = e.target.value; renderBrand(brand); } });
      tb.addEventListener('change', (e) => { if (e.target.dataset.f === 'sort') { state.filters[brand].sort = e.target.value; renderBrand(brand); } });
      tb.addEventListener('click', (e) => {
        const c = e.target.closest('[data-cat]'); if (!c) return;
        state.filters[brand].cat = c.dataset.cat;
        $$('.chip', tb).forEach(x => x.classList.toggle('active', x === c));
        renderBrand(brand);
      });
    }
    if (!state.loaded) { tb.style.display = state.error ? 'none' : ''; return; }
    tb.style.display = brandItems(brand).length ? '' : 'none';
    const items = applyFilters(brand), f = state.filters[brand];
    const filtering = f.q.trim() !== '' || f.cat !== 'all';
    const out = tb.querySelector('[data-count-out]'); if (out) out.textContent = `${items.length} résultat${items.length > 1 ? 's' : ''}`;
    const compare = page.querySelector('.compare-card');
    if (compare) compare.style.display = filtering ? 'none' : '';

    if (brand === 'ajax') {
      const packs = items.filter(p => p.est_pack), others = items.filter(p => !p.est_pack);
      const packsEl = $('#ajax-packs');
      packsEl.closest('.cat-block').style.display = packs.length ? '' : 'none';
      packsEl.innerHTML = packs.map(p => productCard(p)).join('');
      const cats = {}; others.forEach(p => { const k = catKey(p, 'ajax'); (cats[k] = cats[k] || []).push(p); });
      $('#ajax-dynamic-categories').innerHTML = Object.entries(cats).map(([k, arr]) => groupHTML(k, arr)).join('') ||
        (packs.length ? '' : emptyState('Aucun produit ne correspond à votre recherche.', ' Essayez un autre mot-clé ou contactez-nous.'));
    } else if (brand === 'somfy') {
      const packs = items.filter(p => p.est_pack), carte = items.filter(p => !p.est_pack);
      $('#somfy-packs').closest('.cat-block').style.display = packs.length ? '' : 'none';
      $('#somfy-packs').innerHTML = packs.map(p => productCard(p)).join('');
      const carteBlock = $('#somfy-produits').closest('.cat-block');
      carteBlock.style.display = carte.length || !packs.length ? '' : 'none';
      $('#somfy-produits').innerHTML = carte.length ? carte.map(p => productCard(p)).join('') : emptyState('Aucun produit ne correspond à votre recherche.', ' Essayez un autre mot-clé ou contactez-nous.');
    } else {
      const cats = {}; items.forEach(p => { const k = catKey(p, 'yale'); (cats[k] = cats[k] || []).push(p); });
      $('#yale-dynamic-categories').innerHTML = Object.entries(cats).map(([k, arr]) => groupHTML(k, arr)).join('') ||
        emptyState(brandItems('yale').length ? 'Aucun produit ne correspond à votre recherche.' : 'Catalogue Yale Home en cours de mise à jour.', ' Contactez-nous pour un conseil personnalisé.');
    }
  }

  function renderLoading() {
    $('#featured-products').innerHTML = skeletons(4);
    $('#ajax-packs').innerHTML = skeletons(4);
    $('#somfy-packs').innerHTML = skeletons(3);
    $('#somfy-produits').innerHTML = skeletons(4);
    $('#yale-dynamic-categories').innerHTML = `<section class="cat-block"><div class="products-grid">${skeletons(4)}</div></section>`;
  }
  function renderError() {
    const msg = emptyState('Le catalogue est momentanément indisponible.', ' Vous pouvez tout de même nous demander un devis.');
    ['#featured-products', '#ajax-packs', '#somfy-packs', '#somfy-produits'].forEach(s => { $(s).innerHTML = msg; });
    $('#somfy-produits').closest('.cat-block').style.display = 'none';
    $('#yale-dynamic-categories').innerHTML = `<div class="products-grid">${msg}</div>`;
    $$('[data-toolbar]').forEach(t => t.style.display = 'none');
  }

  /* ---------- Détail produit ---------- */
  function formaterDescriptionAutomatique(texteBrut) {
    if (!texteBrut) return "<p>Plus d'informations disponibles sur demande.</p>";
    const lignes = String(texteBrut).split(/<br\s*\/?>|\n/i).map(l => stripTags(l)).filter(l => l.length > 0);
    let html = '', section = 'intro', items = [];
    const fermer = () => {
      if (!items.length) return;
      if (section === 'composition') {
        html += `<div class="box-composition-auto"><h4>📦 Composition du kit</h4><ul>${items.map(it => {
          const parts = it.split(':');
          return parts.length > 1 ? `<li><strong>${esc(parts[0].trim())} :</strong>${esc(parts.slice(1).join(':'))}</li>` : `<li>${esc(it)}</li>`;
        }).join('')}</ul></div>`;
      } else if (section === 'specs') {
        html += `<div class="box-specs-auto"><h4>⚡ Points forts &amp; Spécifications</h4><div class="specs-grid-auto">${items.map(it => {
          const parts = it.split(':');
          return parts.length > 1 ? `<div class="spec-item-card"><strong>${esc(parts[0].trim())}</strong><span>${esc(parts.slice(1).join(':').trim())}</span></div>` : `<div class="spec-item-card"><span>${esc(it)}</span></div>`;
        }).join('')}</div></div>`;
      }
      items = [];
    };
    lignes.forEach(l => {
      const low = l.toLowerCase();
      if (low.includes('composition du kit')) { fermer(); section = 'composition'; return; }
      if (low.includes('points forts') || low.includes('caractéristiques')) { fermer(); section = 'specs'; return; }
      if (section === 'intro') html += `<p>${esc(l)}</p>`; else items.push(l);
    });
    fermer();
    return html;
  }

  let currentDetailId = null;
  function renderDetail(id) {
    const p = state.products[id]; if (!p) return;
    currentDetailId = id;
    const mainImg = $('#detail-image');
    mainImg.src = safeUrl(p.image) || mainImg.src; mainImg.alt = p.nom || '';
    $('#detail-titre').textContent = p.nom || '';
    $('#detail-crumb-name').textContent = p.nom || '';
    const brandLink = $('#detail-crumb-brand');
    brandLink.textContent = BRAND_LABEL[p.marque] || p.marque || 'Gamme';
    const n = parseFloat(p.prix);
    $('#detail-prix').innerHTML = esc(fmtPrice(p.prix)) + (isFinite(n) && n > 0 ? ' <span class="product-tva">TTC</span>' : '');
    $('#detail-desc-courte').textContent = stripTags(p.description || '');
    $('#detail-desc-longue').innerHTML = formaterDescriptionAutomatique(p.description_longue);
    $('#detail-marque').textContent = (BRAND_LABEL[p.marque] || p.marque || '') + (p.categorie ? ' · ' + p.categorie : '');

    const thumbs = $('#detail-thumbnails'); thumbs.innerHTML = '';
    const imgs = [p.image, ...(Array.isArray(p.images_secondaires) ? p.images_secondaires : [])].map(safeUrl).filter(Boolean);
    if (imgs.length > 1) {
      imgs.forEach((src, i) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'thumb-item' + (i === 0 ? ' active' : ''); b.setAttribute('aria-label', 'Vue ' + (i + 1));
        b.innerHTML = `<img src="${esc(src)}" alt="" loading="lazy">`;
        b.addEventListener('click', () => { mainImg.src = src; $$('.thumb-item', thumbs).forEach(x => x.classList.remove('active')); b.classList.add('active'); });
        thumbs.appendChild(b);
      });
      thumbs.style.display = '';
    } else thumbs.style.display = 'none';

    // Produits similaires
    const sims = list().filter(x => x.id !== id && x.marque === p.marque)
      .sort((a, b) => ((b.categorie === p.categorie) - (a.categorie === p.categorie)) || ((b.est_pack === p.est_pack) - (a.est_pack === p.est_pack)))
      .slice(0, 4);
    $('#similar-wrap').style.display = sims.length ? '' : 'none';
    $('#similar-products').innerHTML = sims.map(x => productCard(x)).join('');
    showPage('detail');
  }

  function ouvrirDetailProduit(id) {
    if (!state.products[id]) return;
    setHash('produit/' + id);
    renderDetail(id);
  }

  $('#detail-devis').addEventListener('click', () => {
    const p = state.products[currentDetailId] || {};
    const raison = p.marque === 'ajax' ? 'Demande de devis alarme Ajax' : p.marque === 'somfy' ? 'Demande de devis Somfy' : p.marque === 'yale' ? 'Demande de devis serrure Yale' : 'Renseignement sur un produit';
    ouvrirContactAvecMotif($('#detail-titre').textContent, { raison });
  });
  $('#detail-share').addEventListener('click', async () => {
    const url = location.href, title = $('#detail-titre').textContent;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else { await navigator.clipboard.writeText(url); toast('Lien du produit copié ✔'); }
    } catch (_) { /* partage annulé */ }
  });

  /* ---------- Contact pré-rempli ---------- */
  function ouvrirContactAvecMotif(motif, opts = {}) {
    setHash('contact');
    showPage('contact');
    resetContactView();
    const select = $('#client-raison');
    if (select && opts.raison && [...select.options].some(o => o.value === opts.raison)) select.value = opts.raison;
    const champ = $('#client-message');
    if (champ) champ.value = 'Demande concernant : ' + motif + (opts.details ? '\n' + opts.details : '');
    setTimeout(() => { const n = $('#client-nom'); if (n && window.innerWidth > 680) n.focus({ preventScroll: true }); }, 400);
  }

  /* ---------- Lightbox ---------- */
  function ouvrirPleinEcran(src) {
    const s = src || $('#detail-image').src; if (!s) return;
    $('#lightbox-img').src = s;
    $('#lightbox-modal').classList.add('active');
    document.body.classList.add('no-scroll');
  }
  function fermerPleinEcran(event) {
    if (event) event.stopPropagation();
    $('#lightbox-modal').classList.remove('active');
    document.body.classList.remove('no-scroll');
  }
  $('#detail-image-box').addEventListener('click', () => ouvrirPleinEcran());
  $('#lightbox-modal').addEventListener('click', (e) => { if (e.target.id !== 'lightbox-img') fermerPleinEcran(e); });
  document.addEventListener('click', (e) => { const l = e.target.closest('[data-lightbox]'); if (l) ouvrirPleinEcran(l.dataset.lightbox); });

  /* ---------- Recherche globale ---------- */
  const sModal = $('#search-modal'), sInput = $('#global-search'), sResults = $('#global-results');
  let sFocus = -1;
  function openSearch() {
    sModal.classList.add('active'); document.body.classList.add('no-scroll'); closeMenu();
    sInput.value = ''; renderSearch(); setTimeout(() => sInput.focus(), 30);
  }
  function closeSearch() { sModal.classList.remove('active'); document.body.classList.remove('no-scroll'); }
  function renderSearch() {
    const q = normalize(sInput.value).trim();
    if (!state.loaded) { sResults.innerHTML = `<div class="search-empty">${state.error ? 'Catalogue indisponible pour le moment.' : 'Chargement du catalogue…'}</div>`; return; }
    let items = list();
    if (q) {
      const words = q.split(/\s+/);
      items = items.filter(p => { const hay = normalize([p.nom, p.categorie, BRAND_SHORT[p.marque], p.est_pack ? 'pack kit' : '', stripTags(p.description)].join(' ')); return words.every(w => hay.includes(w)); });
    } else items = items.filter(p => p.est_pack || p.a_la_une);
    items = items.slice(0, 12); sFocus = -1;
    sResults.innerHTML = items.length ? (q ? '' : '<div class="result-reco-title" style="padding:8px 12px 4px">Suggestions</div>') + items.map(p => `
      <button type="button" class="search-result" data-product="${esc(p.id)}">
        ${safeUrl(p.image) ? `<img src="${esc(safeUrl(p.image))}" alt="" loading="lazy">` : ''}
        <span><b>${esc(p.nom)}</b><small>${esc(BRAND_SHORT[p.marque] || '')}${p.categorie ? ' · ' + esc(p.categorie) : ''}${p.est_pack ? ' · Pack' : ''}</small></span>
        <span class="sr-price">${esc(fmtPrice(p.prix))}</span>
      </button>`).join('') : `<div class="search-empty">Aucun résultat pour « ${esc(sInput.value)} ».<br><a href="#contact" data-page="contact" style="color:var(--red);font-weight:700">Demandez-nous conseil →</a></div>`;
  }
  sInput.addEventListener('input', renderSearch);
  sModal.addEventListener('click', (e) => { if (e.target === sModal || e.target.closest('[data-product]') || e.target.closest('[data-page]')) closeSearch(); });
  $$('[data-open-search]').forEach(b => b.addEventListener('click', openSearch));
  sInput.addEventListener('keydown', (e) => {
    const rows = $$('.search-result', sResults);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!rows.length) return;
      sFocus = (sFocus + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      rows.forEach((r, i) => r.classList.toggle('focus', i === sFocus)); rows[sFocus].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      const r = rows[sFocus >= 0 ? sFocus : 0]; if (r) { closeSearch(); ouvrirDetailProduit(r.dataset.product); }
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); sModal.classList.contains('active') ? closeSearch() : openSearch(); }
    if (e.key === 'Escape') { fermerPleinEcran(); closeSearch(); closeMenu(); }
  });

  /* ---------- Configurateur (quiz) ---------- */
  let choixLogement = '', choixBesoin = '', choixMarque = '';
  const choixOptions = new Set();
  const historique = [];
  let etapeCourante = 1;
  const LABELS = {
    appartement: 'Appartement', maison: 'Maison avec extérieur', pro: 'Locaux professionnels',
    intrusion: 'Sécurité & Alarmes', domotique: 'Confort & Domotique', complet: 'Protection Totale',
    cameras: 'Voir à distance', exterieur: "Protéger l'extérieur", acces: 'Accès sans clé', animaux: 'Animaux à la maison'
  };

  function totalEtapes() { return choixBesoin === 'domotique' ? 3 : 4; }
  function afficherEtape(n) {
    etapeCourante = n;
    $$('#quiz .question').forEach(q => q.classList.remove('active'));
    $('#resultat').classList.remove('active');
    if (n === 'resultat') { $('#resultat').classList.add('active'); }
    else $('#etape-' + n).classList.add('active');
    const total = totalEtapes();
    const idx = n === 'resultat' ? total : (n === 4 && total === 3 ? 3 : n);
    $('#quiz-bar').style.width = (n === 'resultat' ? 100 : Math.round(((idx - 1) / total) * 100 + 100 / total / 2)) + '%';
    $('#quiz-step-label').textContent = n === 'resultat' ? 'Recommandation prête' : `Étape ${idx} / ${total}`;
    $('#quiz-back').classList.toggle('show', historique.length > 0);
    $('#quiz-nav-bottom').style.display = n === 'resultat' ? 'none' : '';
    // marquer la réponse déjà choisie
    $$('#quiz [data-step]').forEach(b => {
      const s = b.dataset.step, v = b.dataset.value;
      b.classList.toggle('selected', (s === '1' && v === choixLogement) || (s === '2' && v === choixBesoin) || (s === '3' && v === choixMarque));
    });
  }
  function aller(n) { historique.push(etapeCourante); afficherEtape(n); }

  function repondre(etape, choix) {
    if (etape === 1) { choixLogement = choix; aller(2); }
    else if (etape === 2) { choixBesoin = choix; aller(choix === 'domotique' ? 4 : 3); }
    else if (etape === 3) { choixMarque = choix; aller(4); }
  }

  $('#quiz').addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (b) { b.classList.add('selected'); setTimeout(() => repondre(parseInt(b.dataset.step, 10), b.dataset.value), 180); return; }
    const o = e.target.closest('[data-option]');
    if (o) {
      const k = o.dataset.option;
      if (choixOptions.has(k)) choixOptions.delete(k); else choixOptions.add(k);
      o.classList.toggle('selected', choixOptions.has(k)); o.setAttribute('aria-pressed', String(choixOptions.has(k)));
    }
  });
  $('#quiz-back').addEventListener('click', () => { if (historique.length) afficherEtape(historique.pop()); });
  $('#quiz-finish').addEventListener('click', () => { historique.push(etapeCourante); calculerResultat(); });
  $('#quiz-restart').addEventListener('click', () => recommencerQuizz());

  let dernierResultat = null;
  function calculerResultat() {
    let titre = '', description = '', marqueText = '', niveau = '', marque = '';
    if (choixBesoin === 'domotique') {
      titre = 'SOLUTIONS YALE HOME';
      description = 'Sécurisez vos portes avec nos serrures intelligentes et surveillez vos accès à distance.';
      marqueText = 'Gamme Yale Home recommandée';
      marque = 'yale';
    } else {
      if (choixLogement === 'appartement') {
        niveau = 'ESSENTIEL';
        description = "La base parfaite : Panneau de commande, détecteur de mouvement, détecteur d'ouverture et télécommande. L'idéal pour sécuriser vos accès.";
      } else if (choixBesoin === 'complet') {
        niveau = 'TOUT CONFORT';
        description = 'Protection et confort absolus : Caméras, alarme complète, création de scénarios domotiques et contrôle centralisé.';
      } else {
        niveau = 'CONFORT';
        description = "Dissuasion maximale : Détecteurs extérieurs avec caméra, sirènes intérieures et extérieures. Arrêtez l'effraction avant qu'elle n'arrive.";
      }
      marque = choixMarque === 'ajax' ? 'ajax' : 'somfy';
      const nomMarque = marque === 'ajax' ? 'Ajax' : 'Somfy';
      titre = `PACK ${niveau} ${nomMarque.toUpperCase()}`;
      marqueText = `Gamme ${nomMarque} privilégiée`;
    }
    $('#titre-pack').textContent = titre;
    $('#description-pack').textContent = description;
    $('#marque-pack').textContent = marqueText;
    $('#logement-pack').textContent = LABELS[choixLogement] || '';

    const extras = [];
    if (choixLogement === 'pro') extras.push(['Locaux professionnels', 'nous adaptons la configuration à vos horaires, vos accès et vos zones sensibles.']);
    if (choixOptions.has('cameras')) extras.push(['Voir à distance', 'ajout de caméras ou de détecteurs avec photo pour vérifier une alerte depuis votre smartphone.']);
    if (choixOptions.has('exterieur')) extras.push(["Protection de l'extérieur", "détecteurs extérieurs et sirène extérieure pour dissuader avant l'intrusion."]);
    if (choixOptions.has('acces')) extras.push(['Accès sans clé', 'une serrure connectée Yale Home pour gérer les entrées à distance.']);
    if (choixOptions.has('animaux')) extras.push(['Animaux', 'nous choisissons et réglons des détecteurs adaptés à la présence de vos animaux.']);
    $('#result-extras').innerHTML = extras.map(([t, d]) => `<li><svg width="20" height="20" style="color:var(--red);flex:none;margin-top:2px"><use href="#i-check-circle"/></svg><span><b>${esc(t)} :</b> ${esc(d)}</span></li>`).join('');

    dernierResultat = { titre, marque, niveau };
    afficherRecommandations();
    afficherEtape('resultat');
    const card = $('#quiz'); const r = card.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.4) card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  function afficherRecommandations() {
    const wrap = $('#reco-wrap'), grid = $('#reco-products');
    if (!dernierResultat || !state.loaded) { wrap.style.display = 'none'; return; }
    const { marque, niveau } = dernierResultat;
    const items = brandItems(marque);
    const n = p => normalize(p.nom);
    const score = (p) => {
      let s = p.est_pack ? 10 : 0; const name = n(p);
      if (marque === 'ajax') {
        if (niveau === 'ESSENTIEL') s += (name.includes('starterkit') && !name.includes('cam') ? 8 : 0) - (name.includes('plus') ? 2 : 0);
        if (niveau === 'CONFORT') s += name.includes('cam') ? 8 : 0;
        if (niveau === 'TOUT CONFORT') s += (name.includes('cam') ? 5 : 0) + (name.includes('plus') ? 4 : 0);
      } else if (marque === 'somfy') {
        if (niveau === 'TOUT CONFORT') s += (name.includes('domotique') ? 5 : 0) + (name.includes('alarm') ? 5 : 0);
        else s += name.includes('alarm') ? 8 : 0;
      }
      return s;
    };
    const picks = items.filter(p => p.est_pack).sort((a, b) => score(b) - score(a)).slice(0, 2);
    const addFirst = (pool, re) => { const m = pool.find(p => !p.est_pack && re.test(normalize(p.nom + ' ' + (p.categorie || ''))) && !picks.some(x => x.id === p.id)); if (m) picks.push(m); };
    if (choixOptions.has('cameras')) addFirst(items, /cam/);
    if (choixOptions.has('exterieur')) addFirst(items, /outdoor|exterieur|street/);
    if (choixOptions.has('acces')) addFirst(brandItems('yale'), /serrure/);
    if (picks.length < 2) items.filter(p => !picks.some(x => x.id === p.id)).slice(0, 3 - picks.length).forEach(p => picks.push(p));
    const final = picks.slice(0, 4);
    if (!final.length) { wrap.style.display = 'none'; return; }
    grid.innerHTML = final.map(p => `<button type="button" class="reco-item" data-product="${esc(p.id)}">${safeUrl(p.image) ? `<img src="${esc(safeUrl(p.image))}" alt="" loading="lazy">` : ''}<b>${esc(p.nom)}</b><span>${esc(fmtPrice(p.prix))}</span></button>`).join('');
    wrap.style.display = '';
  }

  $('#quiz-devis').addEventListener('click', () => {
    if (!dernierResultat) return;
    const raison = dernierResultat.marque === 'ajax' ? 'Demande de devis alarme Ajax' : dernierResultat.marque === 'somfy' ? 'Demande de devis Somfy' : 'Demande de devis serrure Yale';
    const details = [
      'Logement : ' + (LABELS[choixLogement] || '-'),
      'Objectif : ' + (LABELS[choixBesoin] || '-'),
      choixOptions.size ? 'Besoins particuliers : ' + [...choixOptions].map(k => LABELS[k]).join(', ') : ''
    ].filter(Boolean).join('\n');
    ouvrirContactAvecMotif(dernierResultat.titre, { raison, details });
  });

  function recommencerQuizz() {
    choixLogement = ''; choixBesoin = ''; choixMarque = ''; choixOptions.clear(); historique.length = 0; dernierResultat = null;
    $$('#quiz [data-option]').forEach(o => { o.classList.remove('selected'); o.setAttribute('aria-pressed', 'false'); });
    afficherEtape(1);
  }

  // Les cartes « Solutions » lancent le configurateur pré-rempli
  $$('[data-quiz-start]').forEach(card => card.addEventListener('click', () => {
    recommencerQuizz();
    choixLogement = card.dataset.quizStart; historique.push(1);
    if (card.dataset.quizNeed) { choixBesoin = card.dataset.quizNeed; historique.push(2); afficherEtape(3); }
    else afficherEtape(2);
    setHash('configurateur');
    $('#configurateur').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }));

  /* ---------- Formulaire de contact ---------- */
  const form = $('#form-contact-client');
  function setInvalid(id, bad) { const g = $('#' + id).closest('.form-group-contact'); if (g) g.classList.toggle('invalid', bad); return !bad; }
  function validContact(v) {
    const s = v.trim();
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
    const phone = /^[+()0-9 .-]{8,20}$/.test(s) && s.replace(/\D/g, '').length >= 8;
    return email || phone;
  }
  function validerFormulaire() {
    let ok = true;
    ok = setInvalid('client-nom', !$('#client-nom').value.trim()) && ok;
    ok = setInvalid('client-prenom', !$('#client-prenom').value.trim()) && ok;
    ok = setInvalid('client-contact', !validContact($('#client-contact').value)) && ok;
    ok = setInvalid('client-raison', !$('#client-raison').value) && ok;
    return ok;
  }
  ['client-nom', 'client-prenom', 'client-contact', 'client-raison'].forEach(id => {
    $('#' + id).addEventListener('input', () => { const g = $('#' + id).closest('.form-group-contact'); if (g.classList.contains('invalid')) validerFormulaire(); });
  });
  function resetContactView() { form.style.display = ''; $('#msg-succes-contact').classList.remove('show'); }
  $('#btn-new-request').addEventListener('click', resetContactView);

  let dernierEnvoi = 0;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#msg-erreur-contact'); err.style.display = 'none';
    if (!validerFormulaire()) { const f = $('.form-group-contact.invalid input, .form-group-contact.invalid select'); if (f) f.focus(); return; }
    if (!$('#client-consent').checked) { err.textContent = 'Merci de cocher la case d’accord pour être recontacté(e).'; err.style.display = 'block'; return; }
    if ($('#client-website').value) { form.reset(); return; } // robot détecté : on ignore
    if (Date.now() - dernierEnvoi < 15000) { err.textContent = 'Votre demande vient d’être envoyée, merci de patienter quelques secondes.'; err.style.display = 'block'; return; }
    if (typeof window.CarapaceEnvoyerDemande !== 'function') { err.textContent = 'Connexion au service impossible pour le moment. Merci de réessayer dans un instant.'; err.style.display = 'block'; return; }

    const btn = $('#btn-submit-contact'); const label = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Envoi en cours...'; btn.disabled = true;
    try {
      // Même structure de données que la version d'origine (collection "demandes_contact")
      await window.CarapaceEnvoyerDemande({
        nom: $('#client-nom').value.trim(),
        prenom: $('#client-prenom').value.trim(),
        contact: $('#client-contact').value.trim(),
        raison: $('#client-raison').value,
        message: $('#client-message').value.trim(),
        date: new Date()
      });
      dernierEnvoi = Date.now();
      form.reset(); form.style.display = 'none';
      $('#msg-succes-contact').classList.add('show');
      $('#msg-succes-contact').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    } catch (error) {
      console.error('Erreur contact :', error);
      err.textContent = "Erreur lors de l'envoi de votre demande. Merci de réessayer ou de nous contacter via Facebook.";
      err.style.display = 'block';
    } finally { btn.innerHTML = label; btn.disabled = false; }
  });

  /* ---------- Branchement avec Firebase ---------- */
  window.Carapace = {
    setProducts(map) {
      state.products = map || {}; state.loaded = true; state.error = false;
      window.produitsDataSite = state.products; // compatibilité
      afficherProduitsPhares();
      ['ajax', 'somfy', 'yale'].forEach(renderBrand);
      if (dernierResultat) afficherRecommandations();
      if (state.pendingDetail) { const id = state.pendingDetail; state.pendingDetail = null; if (state.products[id]) renderDetail(id); else showPage('home'); }
      if (sModal.classList.contains('active')) renderSearch();
      observeReveals();
    },
    setError(err) {
      state.error = true; state.loaded = false;
      console.error('Erreur lors du chargement du catalogue:', err);
      renderError();
      if (state.pendingDetail) { state.pendingDetail = null; showPage('home'); }
    }
  };

  // Fonctions globales conservées (compatibilité avec l'ancienne version)
  Object.assign(window, { showPage, retourMarque, ouvrirContactAvecMotif, ouvrirPleinEcran, fermerPleinEcran, repondre, recommencerQuizz, ouvrirDetailProduit });

  /* ---------- Démarrage ---------- */
  $('#year').textContent = new Date().getFullYear();
  renderLoading();
  afficherEtape(1);
  route();
  onScroll();
  observeReveals();
  setTimeout(animateCounters, 500);
})();
