"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useLockBodyScroll } from "@/hooks/use-lock-body-scroll";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type ModalDialogOptions = {
  open: boolean;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * Supplies the behavior a modal surface needs but CSS cannot provide: initial
 * focus, a focus loop, Escape handling, background isolation, scroll locking,
 * and focus restoration. Search and navigation share this so neither overlay
 * can quietly drift into a different keyboard model.
 */
export function useModalDialog({
  open,
  onClose,
  initialFocusRef,
}: ModalDialogOptions): RefObject<HTMLDivElement | null> {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useLockBodyScroll(open);

  useEffect(() => {
    if (!open || !dialogRef.current) return;

    const dialog = dialogRef.current;
    const restoreFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const isolated: Array<{ element: HTMLElement; wasInert: boolean }> = [];

    // `aria-modal` describes the relationship to assistive technology; inert
    // enforces the same relationship for pointer and keyboard interaction. Walk
    // out to body so this also works for dialogs mounted inside sticky chrome.
    let branch: HTMLElement = dialog;
    while (branch.parentElement) {
      const parent = branch.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        isolated.push({ element: sibling, wasInert: sibling.inert });
        sibling.inert = true;
      }
      branch = parent;
      if (parent === document.body) break;
    }

    const focusables = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true",
      );

    const focusFrame = window.requestAnimationFrame(() => {
      const initialFocus = initialFocusRef?.current ?? focusables()[0] ?? dialog;
      initialFocus.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown, true);
      for (const { element, wasInert } of isolated.reverse()) element.inert = wasInert;
      if (restoreFocus?.isConnected) {
        window.requestAnimationFrame(() => restoreFocus.focus());
      }
    };
  }, [initialFocusRef, open]);

  return dialogRef;
}
