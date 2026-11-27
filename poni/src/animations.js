(() => {
  'use strict';
  const surface = document.getElementById('surface');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let settings = { shelf_fly: true, tab_slide: true, shadow: 'off', celebrate: true, haptics: true };
  let tabAnimation;
  let bounceAnimation;

  const canAnimate = enabled => enabled && !reduceMotion.matches && !surface.classList.contains('power-saving');

  function animatePiece(piece, x, y, keyframes, duration) {
    piece.style.left = x + 'px';
    piece.style.top = y + 'px';
    surface.append(piece);
    piece.animate(keyframes, { duration, easing: 'ease-out' }).finished.catch(() => {}).finally(() => piece.remove());
  }

  window.poniAnimations = {
    configure(value) {
      settings = { ...settings, ...value };
      surface.dataset.shadow = settings.shadow;
    },
    tab(page, delta) {
      if (!canAnimate(settings.tab_slide) || !delta) return;
      tabAnimation?.cancel();
      const rtl = document.documentElement.dir === 'rtl';
      tabAnimation = page.animate([
        { transform: `translateX(${(rtl ? -1 : 1) * Math.sign(delta) * 20}px)`, opacity: .45 },
        { transform: 'translateX(0)', opacity: 1 },
      ], { duration: 180, easing: 'ease-out' });
    },
    file(position) {
      if (!canAnimate(settings.shelf_fly) || !position) return;
      const tab = document.querySelector('.tab[data-page="shelf"]');
      const visibleTabs = tab.parentElement.getBoundingClientRect();
      const tabBounds = tab.getBoundingClientRect();
      const shelf = document.querySelector('#page-shelf').getBoundingClientRect();
      const target = tabBounds.left >= visibleTabs.left && tabBounds.right <= visibleTabs.right ? tabBounds : shelf;
      if (target.width === 0) return;
      const scale = window.devicePixelRatio || 1;
      const x = position.x / scale, y = position.y / scale;
      const destinationX = target.left + Math.min(target.width / 2, 55);
      const destinationY = target.top + Math.min(target.height / 2, 22);
      const distanceX = destinationX - x, distanceY = destinationY - y;
      const piece = document.createElement('span');
      piece.className = 'shelf-flight';
      piece.textContent = '▰';
      piece.setAttribute('aria-hidden', 'true');
      animatePiece(piece, x, y, [
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${distanceX * .55}px), calc(-50% + ${distanceY * .55 - 15}px)) scale(.75)`, opacity: .8 },
        { transform: `translate(calc(-50% + ${distanceX}px), calc(-50% + ${distanceY}px)) scale(.2)`, opacity: 0 },
      ], 320);
    },
    celebrate() {
      if (!canAnimate(settings.celebrate)) return;
      const colors = ['#ff6d79', '#ffc86a', '#76b9ff', '#65d98c'];
      const x = surface.clientWidth / 2, y = Math.min(surface.clientHeight / 2, 28);
      for (let index = 0; index < 18; index++) {
        const piece = document.createElement('i');
        piece.className = 'task-confetti';
        piece.setAttribute('aria-hidden', 'true');
        piece.style.backgroundColor = colors[index % colors.length];
        const horizontal = ((index % 9) - 4) * (index < 9 ? 12 : 19);
        const vertical = 21 + index * 3;
        animatePiece(piece, x, y, [
          { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
          { transform: `translate(${horizontal}px, -10px) rotate(${index * 22}deg)`, opacity: 1, offset: .42 },
          { transform: `translate(${horizontal * 1.3}px, ${vertical}px) rotate(${index * 43}deg)`, opacity: 0 },
        ], 810);
      }
    },
    bounce() {
      const closed = document.getElementById('closed');
      if (!canAnimate(settings.haptics) || closed.hidden) return;
      bounceAnimation?.cancel();
      bounceAnimation = closed.animate([
        {transform:'scale(1)'}, {transform:'scale(1.035, 1.09)', offset:.35},
        {transform:'scale(.99, .985)', offset:.7}, {transform:'scale(1)'},
      ], {duration:320, easing:'ease-out'});
    },
  };
})();
