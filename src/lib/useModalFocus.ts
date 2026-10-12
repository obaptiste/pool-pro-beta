import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard focus handling for a dialog that opens over the app. While
 * `isOpen`, focus moves into the dialog, Tab and Shift+Tab stay inside it,
 * Escape calls onClose, and focus returns to whatever had it on open.
 * Attach the returned ref to the dialog's root element, which should carry
 * tabIndex={-1} so focus has somewhere to land if it has no controls.
 * onClose is read through a ref, so an inline callback doesn't re-run setup
 * on every render.
 */
export function useModalFocus<T extends HTMLElement>(isOpen: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const items = () => Array.from(root?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      .filter((el) => el.getClientRects().length > 0);

    (items()[0] ?? root)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !root) return;
      const list = items();
      const first = list[0] ?? root;
      const last = list[list.length - 1] ?? root;
      const active = document.activeElement;
      // Focus already left the dialog (e.g. a click on the backdrop): pull it back.
      if (!root.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [isOpen]);

  return ref;
}
