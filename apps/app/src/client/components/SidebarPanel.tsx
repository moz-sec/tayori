import { useLayoutEffect, useRef, type ReactNode } from "react";
import { LuPanelLeftClose } from "react-icons/lu";
import "./SidebarPanel.css";

interface SidebarPanelProps {
  open: boolean;
  desktop: boolean;
  onDismiss: () => void;
  children: ReactNode;
}

/** Reserves a desktop column and uses the browser's modal focus handling on mobile. */
export function SidebarPanel({ open, desktop, onDismiss, children }: SidebarPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const activeElement = document.activeElement;
    if (dialog.open) dialog.close();
    if (!open) return;
    if (desktop) {
      // Opening a persistent navigation column must not autofocus its first control.
      dialog.open = true;
      if (activeElement instanceof HTMLElement) activeElement.focus({ preventScroll: true });
    } else {
      dialog.showModal();
      closeRef.current?.focus({ preventScroll: true });
      const previousOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
      return () => { document.documentElement.style.overflow = previousOverflow; };
    }
  }, [open, desktop]);

  return <dialog
    ref={dialogRef}
    id="tayori-sidebar"
    className="tayori-sidebar-panel"
    aria-label="購読ナビゲーション"
    aria-modal={desktop ? undefined : true}
    onCancel={(event) => {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      onDismiss();
    }}
    onClick={(event) => {
      if (desktop || event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom) onDismiss();
    }}
  >
    <button ref={closeRef} id="tayori-sidebar-close" type="button" className="tayori-sidebar-close btn btn-square btn-ghost btn-sm" onClick={onDismiss} aria-label="サイドバーを閉じる"><LuPanelLeftClose aria-hidden="true" /></button>
    {children}
  </dialog>;
}
