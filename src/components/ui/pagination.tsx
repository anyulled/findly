import * as React from "react";
import styles from "./pagination.module.css";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";

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

export function PaginationContent({ className = "", ...props }: React.ComponentProps<"ul">) {
  return <ul className={[styles.paginationContent, className].filter(Boolean).join(" ")} {...props} />;
}

export function PaginationItem({ className = "", ...props }: React.ComponentProps<"li">) {
  return <li className={[styles.paginationItem, className].filter(Boolean).join(" ")} {...props} />;
}

export interface PaginationLinkProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive?: boolean;
}

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
