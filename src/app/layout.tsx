import type { Metadata, Viewport } from "next";
import "./globals.css";
import { I18nRoot } from "@/components/I18nRoot";
import { BrandInit } from "@/components/Brand";
import { BRAND_BOOT_SCRIPT } from "@/lib/brand";

export const metadata: Metadata = {
  title: "DYASPlanning",
  description: "Planificarea echipelor și pontaj pentru firme de construcții",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
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
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(location.pathname.indexOf("/prezentare")===0)return;var l=localStorage.getItem("dyas.lang");if(!l){var n=(navigator.language||"ro").toLowerCase();l=(n.indexOf("ro")===0||n.indexOf("mo")===0)?"ro":"en";}if(l==="en"){var d=document.documentElement;d.lang="en";d.classList.add("i18n-pending");setTimeout(function(){d.classList.remove("i18n-pending")},2500);}}catch(e){}})();` }} />
        {/* culorile aplicației firmei, aplicate înainte de afișare */}
        <script dangerouslySetInnerHTML={{ __html: BRAND_BOOT_SCRIPT }} />
      </head>
      <body>{children}<I18nRoot /><BrandInit /></body>
    </html>
  );
}
