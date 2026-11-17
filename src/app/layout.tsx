import type { Metadata, Viewport } from "next";
import "./globals.css";
import { I18nRoot } from "@/components/I18nRoot";

export const metadata: Metadata = {
  title: "DYASPlanning",
  description: "Planificarea echipelor și pontaj pentru firme de construcții",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "DYASPlanning", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ea580c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro" suppressHydrationWarning>
      <head>
        {/* limba engleză: ascunde pagina până se aplică traducerea (fără „flash” în română) */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var l=localStorage.getItem("dyas.lang");if(!l){var n=(navigator.language||"ro").toLowerCase();l=(n.indexOf("ro")===0||n.indexOf("mo")===0)?"ro":"en";}if(l==="en"){var d=document.documentElement;d.lang="en";d.classList.add("i18n-pending");setTimeout(function(){d.classList.remove("i18n-pending")},2500);}}catch(e){}})();` }} />
      </head>
      <body>{children}<I18nRoot /></body>
    </html>
  );
}
