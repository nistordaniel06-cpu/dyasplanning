"use client";
import { useEffect } from "react";
import { initBrand, useBrand } from "@/lib/brand";

/** Iconița aplicației în culoarea firmei. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" fill="var(--color-orange-600)" />
      <path d="M14 46V22l18-10 18 10v24H38V32H26v14z" fill="#fff" />
    </svg>
  );
}

/** Numele aplicației (al firmei sau DYASPlanning). Nu se traduce. */
export function BrandName({ className }: { className?: string }) {
  const b = useBrand();
  return <span className={className} data-no-i18n>{b.name}</span>;
}

export function BrandInit() {
  useEffect(() => { initBrand(); }, []);
  return null;
}
