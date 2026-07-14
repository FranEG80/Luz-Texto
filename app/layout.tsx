import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MediaTagOptimizer",
  description: "Cataloga fotos y vídeos con títulos, descripciones y palabras clave.",
  icons: { icon: "/media-tag-optimizer.png", apple: "/media-tag-optimizer.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
