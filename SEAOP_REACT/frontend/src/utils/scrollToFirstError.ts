/**
 * Smoothly scroll the first invalid form field into view and focus it.
 * Call this right after `setErrors(...)` returns errors, e.g.:
 *   setErrors(errs);
 *   if (Object.keys(errs).length > 0) scrollToFirstError();
 *
 * Uses requestAnimationFrame so the browser has a chance to paint the
 * `aria-invalid="true"` attribute and red border BEFORE we scroll.
 */
export function scrollToFirstError() {
  requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Defer focus so smooth-scroll finishes first; otherwise focus jumps.
    setTimeout(() => target.focus({ preventScroll: true }), 250);
  });
}
