"use client";

import * as React from "react";
import styles from "./table.module.css";

export function Table({
  className = "",
  children,
  ...props
}: React.ComponentProps<"table">) {
  return (
    <div className={styles.tableContainer}>
      <table
        className={[styles.tableRoot, className].filter(Boolean).join(" ")}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

export function TableHeader({
  className = "",
  children,
  ...props
}: React.ComponentProps<"thead">) {
  return (
    <thead
      className={[styles.tableHeader, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </thead>
  );
}

export function TableBody({
  className = "",
  children,
  ...props
}: React.ComponentProps<"tbody">) {
  return (
    <tbody
      className={[styles.tableBody, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </tbody>
  );
}

export function TableFooter({
  className = "",
  children,
  ...props
}: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      className={[styles.tableFooter, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </tfoot>
  );
}

export function TableRow({
  className = "",
  children,
  ...props
}: React.ComponentProps<"tr">) {
  return (
    <tr
      className={[styles.tableRow, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </tr>
  );
}

export function TableHead({
  className = "",
  children,
  ...props
}: React.ComponentProps<"th">) {
  return (
    <th
      className={[styles.tableHead, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </th>
  );
}

export function TableCell({
  className = "",
  children,
  ...props
}: React.ComponentProps<"td">) {
  return (
    <td
      className={[styles.tableCell, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </td>
  );
}

export function TableCaption({
  className = "",
  children,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      className={[styles.tableCaption, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </caption>
  );
}
