import * as React from "react";
import styles from "./pagination.module.css";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";

/**
 * Root pagination navigation container.
 *
 * @param props - Navigation element props.
 * @returns The rendered accessible pagination nav component.
 */
export function Pagination({ className = "", ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      role="navigation"
      aria-label="Paginación"
      className={[styles.pagination, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

/**
 * Ordered list container for pagination items.
 *
 * @param props - Unordered list element props.
 * @returns The rendered pagination content list.
 */
export function PaginationContent({ className = "", ...props }: React.ComponentProps<"ul">) {
  return <ul className={[styles.paginationContent, className].filter(Boolean).join(" ")} {...props} />;
}

/**
 * Individual list item for a pagination element.
 *
 * @param props - List item element props.
 * @returns The rendered pagination list item.
 */
export function PaginationItem({ className = "", ...props }: React.ComponentProps<"li">) {
  return <li className={[styles.paginationItem, className].filter(Boolean).join(" ")} {...props} />;
}

/**
 * Props for pagination link and action button components.
 */
export interface PaginationLinkProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether this link represents the currently active page. */
  isActive?: boolean;
}

/**
 * Button representing an individual page link in the pagination control.
 *
 * @param props - Button props and active page state.
 * @returns The rendered pagination link button.
 */
export function PaginationLink({
  className = "",
  isActive = false,
  ...props
}: PaginationLinkProps) {
  return (
    <button
      type="button"
      aria-current={isActive ? "page" : undefined}
      className={[
        styles.paginationLink,
        isActive ? styles.paginationLinkActive : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

/**
 * Previous page navigation button.
 *
 * @param props - Button props and custom children.
 * @returns The rendered previous page button with ChevronLeft icon.
 */
export function PaginationPrevious({
  className = "",
  children = "Anterior",
  ...props
}: PaginationLinkProps) {
  return (
    <PaginationLink
      aria-label="Ir a la página anterior"
      className={[styles.paginationButton, className].filter(Boolean).join(" ")}
      {...props}
    >
      <ChevronLeft size={16} aria-hidden="true" />
      <span>{children}</span>
    </PaginationLink>
  );
}

/**
 * Next page navigation button.
 *
 * @param props - Button props and custom children.
 * @returns The rendered next page button with ChevronRight icon.
 */
export function PaginationNext({
  className = "",
  children = "Siguiente",
  ...props
}: PaginationLinkProps) {
  return (
    <PaginationLink
      aria-label="Ir a la página siguiente"
      className={[styles.paginationButton, className].filter(Boolean).join(" ")}
      {...props}
    >
      <span>{children}</span>
      <ChevronRight size={16} aria-hidden="true" />
    </PaginationLink>
  );
}

/**
 * Visual ellipsis indicator for skipped page ranges.
 *
 * @param props - Span element props.
 * @returns The rendered pagination ellipsis element.
 */
export function PaginationEllipsis({ className = "", ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      className={[styles.paginationEllipsis, className].filter(Boolean).join(" ")}
      {...props}
    >
      <MoreHorizontal size={16} />
      <span className="sr-only">Más páginas</span>
    </span>
  );
}
