(() => {
  const slides = Array.from(document.querySelectorAll(".slide"));
  const deck = document.querySelector(".deck");
  const slidesHost = document.getElementById("slides");
  const dots = document.getElementById("slide-dots");
  const previous = document.getElementById("prev-slide");
  const next = document.getElementById("next-slide");
  const number = document.getElementById("slide-number");
  const total = document.getElementById("slide-total");
  const section = document.getElementById("section-name");
  const brandHome = document.getElementById("brand-home");
  let active = 0;
  let scrollFrame = 0;

  total.textContent = String(slides.length);
  slides.forEach((slide, index) => {
    slide.setAttribute("aria-hidden", "false");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "slide-dot";
    button.setAttribute("aria-label", `Go to slide ${index + 1}: ${slide.dataset.section}`);
    button.addEventListener("click", () => goTo(index));
    dots.appendChild(button);
  });

  const dotButtons = Array.from(dots.querySelectorAll(".slide-dot"));

  function setActive(index, updateHash = true) {
    const nextIndex = Math.max(0, Math.min(index, slides.length - 1));
    if (nextIndex === active && updateHash && window.location.hash === `#s-${nextIndex + 1}`) return;

    active = nextIndex;
    deck.classList.toggle("on-title-slide", active === 0);
    slides.forEach((slide, slideIndex) => slide.classList.toggle("is-active", slideIndex === active));
    dotButtons.forEach((dot, dotIndex) => {
      const isActive = dotIndex === active;
      dot.classList.toggle("is-active", isActive);
      dot.setAttribute("aria-current", isActive ? "page" : "false");
    });
    number.textContent = String(active + 1);
    section.textContent = slides[active].dataset.section;
    previous.disabled = active === 0;
    next.disabled = active === slides.length - 1;
    if (updateHash) history.replaceState(null, "", `#s-${active + 1}`);
  }

  function goTo(index, behavior = "smooth") {
    const nextIndex = Math.max(0, Math.min(index, slides.length - 1));
    setActive(nextIndex);
    slidesHost.scrollTo({ top: slides[nextIndex].offsetTop, behavior });
  }

  function syncActiveSlide() {
    scrollFrame = 0;
    const hostTop = slidesHost.getBoundingClientRect().top;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    slides.forEach((slide, index) => {
      const distance = Math.abs(slide.getBoundingClientRect().top - hostTop);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    setActive(nearestIndex);
  }

  slidesHost.addEventListener("scroll", () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(syncActiveSlide);
  }, { passive: true });

  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) setActive(slides.indexOf(visible.target));
  }, { root: slidesHost, threshold: [0.35, 0.6] });
  slides.forEach((slide) => observer.observe(slide));

  previous.addEventListener("click", () => goTo(active - 1));
  next.addEventListener("click", () => goTo(active + 1));
  brandHome.addEventListener("click", (event) => {
    event.preventDefault();
    goTo(0);
  });
  document.addEventListener("keydown", (event) => {
    if (["ArrowRight", "PageDown"].includes(event.key)) {
      event.preventDefault();
      goTo(active + 1);
    }
    if (["ArrowLeft", "PageUp"].includes(event.key)) {
      event.preventDefault();
      goTo(active - 1);
    }
    if (event.key === "Home") goTo(0);
    if (event.key === "End") goTo(slides.length - 1);
  });

  const requested = Number.parseInt(window.location.hash.replace("#s-", ""), 10);
  const initial = Number.isFinite(requested) ? requested - 1 : 0;
  setActive(initial, false);
  requestAnimationFrame(() => goTo(initial, "auto"));
})();
