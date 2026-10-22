/** Elements that already use Space/Enter themselves. */
const INTERACTIVE =
  'input, textarea, select, button, a[href], summary, [contenteditable=""], [contenteditable="true"], [role="button"], [role="radio"], [role="checkbox"], [role="tab"], [role="menuitem"], [role="link"]';

/**
 * True when a keydown should trigger the page's main game action (spin / deal):
 * Space or Enter, no modifiers, not a repeat, not typed into a control, and
 * no dialog open. Focus on the game stage itself counts as "page level".
 */
export function isSpinHotkey(event: KeyboardEvent): boolean {
  if (event.key !== ' ' && event.key !== 'Enter') return false;
  if (
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return false;
  if (event.defaultPrevented) return false;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(INTERACTIVE)) return false;
  if (target?.closest('dialog[open]') || document.querySelector('dialog[open]'))
    return false;
  return true;
}
