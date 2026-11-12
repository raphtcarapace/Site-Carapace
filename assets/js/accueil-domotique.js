// En-tête, menu et révélations. Pas de panier, pas de catalogue distant.
const header = document.getElementById("site-header");
const onScroll = () => {
  if (header) header.classList.toggle("is-solid", window.scrollY > 24);
  const sticky = document.getElementById("sticky-cta");
  if (sticky) sticky.classList.toggle("show", window.scrollY > 640);
};
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());
document.getElementById("to-top")?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

const menu = document.getElementById("mobile-menu");
const burger = document.getElementById("burger");
function closeMenu() {
  if (!menu) return;
  menu.classList.remove("open");
  menu.setAttribute("aria-hidden", "true");
  burger?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("no-scroll");
}
burger?.addEventListener("click", () => {
  const open = !menu.classList.contains("open");
  menu.classList.toggle("open", open);
  menu.setAttribute("aria-hidden", open ? "false" : "true");
  burger.setAttribute("aria-expanded", open ? "true" : "false");
  document.body.classList.toggle("no-scroll", open);
});
menu?.querySelector("[data-close-menu]")?.addEventListener("click", closeMenu);
menu?.addEventListener("click", (e) => { if (e.target.closest("a")) closeMenu(); });

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const reveals = document.querySelectorAll(".reveal");
if (reduce || !("IntersectionObserver" in window)) {
  reveals.forEach((el) => el.classList.add("in"));
} else {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("in");
      io.unobserve(entry.target);
    });
  }, { threshold: 0.14 });
  reveals.forEach((el) => io.observe(el));
}
