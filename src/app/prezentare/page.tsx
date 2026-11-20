import type { Metadata } from "next";
import Image from "next/image";
import { MessageCircle } from "lucide-react";
import { DemoPlayer } from "./DemoPlayer";

// Pagina publică de prezentare (fără cont). Datele din capturi sunt fictive.
const TITLE = "Vezi cine lucrează azi pe fiecare șantier · DYAS Planning";
const DESCRIPTION = "Demonstrație de 1 minut: împarți oamenii pe două șantiere, dai fiecăruia sarcina lui și verifici seara orele pe fiecare lucrare. De pe telefon.";
const VIDEO = "/prezentare/dyas-planning-demo.mp4";
const DURATION = "1 min"; // filmul are 62 de secunde
const WA_TEXT = "Bună! Am văzut demonstrația DYAS Planning și aș vrea să discutăm despre folosirea aplicației în firma mea.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://dyasplanning.vercel.app"),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/prezentare" },
  openGraph: {
    type: "website", locale: "ro_RO", url: "/prezentare", siteName: "DYAS Planning", title: "Vezi cine lucrează azi pe fiecare șantier.", description: DESCRIPTION,
    images: [{ url: "/prezentare/og.jpg", width: 1200, height: 630, alt: "Planul zilei în DYAS Planning: două șantiere, trei oameni, fiecare cu sarcina lui" }],
    videos: [{ url: VIDEO, type: "video/mp4", width: 1920, height: 1080 }],
  },
  twitter: { card: "summary_large_image", title: "Vezi cine lucrează azi pe fiecare șantier.", description: DESCRIPTION, images: ["/prezentare/og.jpg"] },
};

/** Numărul de WhatsApp de vânzări, doar cifre, cu prefixul țării (ex. 40722123456) — din NEXT_PUBLIC_SALES_WHATSAPP. */
function salesLink(): string | null {
  const n = (process.env.NEXT_PUBLIC_SALES_WHATSAPP ?? "").replace(/\D/g, "");
  return n.length >= 8 ? `https://wa.me/${n}?text=${encodeURIComponent(WA_TEXT)}` : null;
}

const STEPS = [
  { img: "/prezentare/ecran-1-planul-zilei.jpg", title: "Dimineața: cine merge unde?", text: "Vezi pe un singur ecran fiecare șantier și oamenii trimiși acolo azi — Elena la Grozăvești, Andrei și Mihai în Militari." },
  { img: "/prezentare/ecran-2-sarcini.jpg", title: "Pe șantier: cine ce face?", text: "Pe aceeași lucrare, fiecare om primește sarcina lui: Andrei montează pereții de gips-carton, Mihai pregătește instalația electrică." },
  { img: "/prezentare/ecran-3-validare.jpg", title: "Seara: câte ore, pe ce lucrare?", text: "Vezi orele fiecăruia pe lucrarea lui, corectezi dacă e cazul și validezi ziua cu un clic." },
];

export default function PrezentarePage() {
  const wa = salesLink();
  return (
    <main data-no-i18n className="min-h-dvh bg-white text-slate-900">
      <header className="mx-auto flex max-w-5xl items-center gap-3 px-5 pt-5">
        <img src="/icon.svg" alt="" width={40} height={40} />
        <span className="text-lg font-extrabold tracking-tight">DYAS Planning</span>
      </header>

      {/* Primul ecran: ce face aplicația + filmul */}
      <section className="mx-auto max-w-5xl px-5 pb-12 pt-8 sm:pt-12">
        <p className="mb-3 text-sm font-bold uppercase tracking-wide text-orange-700">Planificare pentru firme de construcții</p>
        <h1 className="text-[2.15rem] font-extrabold leading-[1.1] tracking-tight sm:text-5xl">Vezi cine lucrează azi pe fiecare șantier.</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-700">
          În 1 minut: împarți oamenii pe două șantiere, dai fiecăruia sarcina lui și verifici seara câte ore a lucrat fiecare, pe ce lucrare.
        </p>
        <div className="mt-6"><DemoPlayer src={VIDEO} poster="/prezentare/coperta.jpg" duration={DURATION} /></div>
      </section>

      {/* O zi cu DYAS Planning */}
      <section className="bg-orange-50/60 py-12">
        <div className="mx-auto max-w-5xl px-5">
          <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">O zi cu DYAS Planning</h2>
          <p className="mt-2 text-slate-700">Luni, două șantiere, o singură echipă. Capturi din aplicație, cu date de exemplu.</p>
          <ol className="mt-8 grid gap-10 sm:grid-cols-3 sm:gap-6">
            {STEPS.map((s, i) => (
              <li key={s.img}>
                <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[2rem] border-[6px] border-slate-900 bg-slate-900 shadow-xl">
                  <Image src={s.img} alt={s.title} width={780} height={1689} className="h-auto w-full" unoptimized />
                </div>
                <h3 className="mt-5 text-lg font-bold"><span className="mr-2 text-orange-700">{i + 1}.</span>{s.title}</h3>
                <p className="mt-1 leading-relaxed text-slate-700">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Încheiere */}
      <section className="mx-auto max-w-5xl px-5 py-14 text-center">
        <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Cum ar arăta planul de mâine pentru echipa ta?</h2>
        <p className="mx-auto mt-3 max-w-xl text-slate-700">Îți arătăm aplicația pe lucrările și oamenii firmei tale.</p>
        {wa ? (
          <a href={wa} target="_blank" rel="noopener noreferrer"
            className="mt-7 inline-flex w-full items-center justify-center gap-3 rounded-2xl bg-orange-600 px-6 py-4 text-lg font-bold text-white shadow-lg shadow-orange-600/25 sm:w-auto">
            <MessageCircle className="h-6 w-6" aria-hidden />Cere o demonstrație pentru firma mea
          </a>
        ) : (
          <div className="mt-7">
            <span aria-disabled="true" className="inline-flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-2xl bg-slate-200 px-6 py-4 text-lg font-bold text-slate-500 sm:w-auto">
              <MessageCircle className="h-6 w-6" aria-hidden />Cere o demonstrație pentru firma mea
            </span>
            <p className="mt-2 text-sm text-slate-500">Contactul de vânzări nu e încă setat.</p>
          </div>
        )}
        <p className="mt-4 text-sm text-slate-500">Se deschide WhatsApp cu mesajul pregătit; îl trimiți tu.</p>
      </section>

      <footer className="border-t border-slate-100 py-6 text-center text-sm text-slate-500">DYAS Planning · planificare și pontaj pentru construcții</footer>
    </main>
  );
}
