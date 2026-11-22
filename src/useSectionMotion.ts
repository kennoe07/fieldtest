import { useEffect, type RefObject } from 'react';

/** One observer, one short animation per section. Content is never hidden in CSS. */
export function useSectionMotion(scope: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = scope.current;
    if (!root || !('IntersectionObserver' in window) || !('animate' in Element.prototype)) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let observer: IntersectionObserver | undefined;
    const active = new Set<Animation>();
    const seen = new WeakSet<Element>();

    function stop() {
      observer?.disconnect();
      active.forEach(animation => animation.cancel());
      active.clear();
      root?.querySelector('.signal-hero')?.removeAttribute('data-in-view');
    }

    function start() {
      stop();
      if (preference.matches || !root) return;
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.target.matches('.signal-hero')) {
            entry.target.toggleAttribute('data-in-view', entry.isIntersecting);
            return;
          }
          if (!entry.isIntersecting || seen.has(entry.target)) return;
          seen.add(entry.target);
          observer?.unobserve(entry.target);
          // Translate and opacity only: no layout animation or continuous scroll work.
          const animation = entry.target.animate(
            [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }],
            { duration: 420, easing: 'cubic-bezier(.2,.65,.3,1)' },
          );
          active.add(animation);
          animation.onfinish = () => active.delete(animation);
          animation.oncancel = () => active.delete(animation);
        });
      }, { threshold: 0, rootMargin: '0px 0px -24px 0px' });
      root.querySelectorAll('[data-reveal]').forEach(element => {
        if (!seen.has(element)) observer?.observe(element);
      });
      const hero = root.querySelector('.signal-hero');
      if (hero) observer.observe(hero);
    }

    function visibility() { root?.toggleAttribute('data-page-hidden', document.hidden); }
    visibility();
    document.addEventListener('visibilitychange', visibility);
    start();
    preference.addEventListener('change', start);
    return () => { stop(); document.removeEventListener('visibilitychange', visibility); root?.removeAttribute('data-page-hidden'); preference.removeEventListener('change', start); };
  }, [scope]);
}
