"use client";
import { useEffect } from "react";
import { startI18n } from "@/lib/i18n";

/** Montat o singură dată în layout: aplică limba aleasă pe toată interfața. */
export function I18nRoot() {
  useEffect(() => { startI18n(); }, []);
  return null;
}
