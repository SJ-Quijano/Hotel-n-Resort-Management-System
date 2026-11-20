const homeHero = document.querySelector(".home-hero");
const heroSliderStatus = document.getElementById("heroSliderStatus");
const heroImages = [
  "https://images.unsplash.com/photo-1678913308053-316cee77afe9?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=NHwxMjA3fDA%3D",
  "https://images.unsplash.com/photo-1678912128919-b69e9e855c00?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=NHwxMjA3fDA%3D",
  "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=1200&q=85",
  "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=850&q=80",
  "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1200&q=85",
  "https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1200&q=85"
];
let activeHeroImage = 0;
let heroTransitioning = false;
let heroRotationTimer = null;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function showHeroImage(offset) {
  if (heroTransitioning) return;

  activeHeroImage = (activeHeroImage + offset + heroImages.length) % heroImages.length;
  const image = `url("${heroImages[activeHeroImage]}")`;
  heroTransitioning = true;
  heroSliderStatus.textContent = `Image ${activeHeroImage + 1} of ${heroImages.length}`;
  homeHero.style.setProperty("--hero-next-image", image);
  homeHero.classList.add("is-transitioning");

  window.setTimeout(() => {
    homeHero.style.setProperty("--hero-current-image", image);
    homeHero.classList.remove("is-transitioning");
    homeHero.style.removeProperty("--hero-next-image");
    heroTransitioning = false;
  }, 500);
}

document.getElementById("heroPrevious").addEventListener("click", () => showHeroImage(-1));
document.getElementById("heroNext").addEventListener("click", () => showHeroImage(1));

function pauseHeroRotation() {
  window.clearInterval(heroRotationTimer);
  heroRotationTimer = null;
}

function startHeroRotation() {
  pauseHeroRotation();
  if (reduceMotion || document.hidden || homeHero.matches(":hover") || homeHero.contains(document.activeElement)) return;
  heroRotationTimer = window.setInterval(() => showHeroImage(1), 6500);
}

homeHero.addEventListener("pointerenter", pauseHeroRotation);
homeHero.addEventListener("pointerleave", startHeroRotation);
homeHero.addEventListener("focusin", pauseHeroRotation);
homeHero.addEventListener("focusout", (event) => {
  if (!homeHero.contains(event.relatedTarget)) startHeroRotation();
});
document.addEventListener("visibilitychange", startHeroRotation);
startHeroRotation();

if ("IntersectionObserver" in window && !reduceMotion) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  const revealTargets = document.querySelectorAll(
    ".welcome-section > *, .stay-image, .stay-card, .experiences-heading, .experience-card, .amenities-heading, .amenities-note, .amenity-card, .amenity-references, .site-footer > *"
  );
  revealTargets.forEach((target) => {
    target.classList.add("home-reveal");
    revealObserver.observe(target);
  });
}
