import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "findly · Event social planner",
  description: "Prepara y organiza las publicaciones de tus eventos.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/icon-64.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
