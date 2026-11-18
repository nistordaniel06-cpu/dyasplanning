"use client";
// Raport lunar PDF pe angajat, pentru contabilitate. jsPDF se încarcă doar când e nevoie.
import { decimalHours, formatMinutes } from "./hours";
import { getLang } from "./lang";
import { monthLabel } from "./time";
import type { MonthSheet } from "./timesheet";
import type { AbsenceType } from "./types";

const T = {
  ro: {
    title: "Foaie de pontaj lunară", employee: "Angajat", trade: "Meserie", month: "Luna",
    cols: ["Data", "Zi", "Lucrare / misiune", "Interval", "Pauză", "Ore", "Status"],
    days: ["", "Lun", "Mar", "Mie", "Joi", "Vin", "Sâm", "Dum"],
    approved: "Ore aprobate", submitted: "Ore trimise, încă neaprobate", total: "Total ore", workedDays: "Zile lucrate",
    absences: "Absențe", none: "—",
    status: { aprobat: "Aprobat", trimis: "Trimis", ciorna: "Ciornă", respins: "Respins" },
    absence: { concediu: "Concediu", medical: "Concediu medical", absent: "Absent", alt_motiv: "Indisponibil" } as Record<AbsenceType, string>,
    note: "Sunt incluse pontajele aprobate și cele trimise. Ciornele și pontajele respinse nu sunt incluse. ✓ = pontat cu butonul (oră și loc notate automat).",
    sigEmployee: "Semnătură angajat", sigAdmin: "Semnătură administrator", generated: "Generat", page: "Pagina",
  },
  en: {
    title: "Monthly timesheet", employee: "Employee", trade: "Trade", month: "Month",
    cols: ["Date", "Day", "Job / task", "Time", "Break", "Hours", "Status"],
    days: ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    approved: "Approved hours", submitted: "Submitted, not yet approved", total: "Total hours", workedDays: "Days worked",
    absences: "Absences", none: "—",
    status: { aprobat: "Approved", trimis: "Submitted", ciorna: "Draft", respins: "Rejected" },
    absence: { concediu: "Leave", medical: "Sick leave", absent: "Absent", alt_motiv: "Unavailable" } as Record<AbsenceType, string>,
    note: "Approved and submitted entries are included. Drafts and rejected entries are not. ✓ = clocked with the button (time and place recorded automatically).",
    sigEmployee: "Employee signature", sigAdmin: "Manager signature", generated: "Generated", page: "Page",
  },
};

async function fontBase64(url: string): Promise<string> {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function monthlyPdf(opts: { companyName: string; sheets: MonthSheet[] }): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const [regular, bold] = await Promise.all([fontBase64("/fonts/DejaVuSans.ttf"), fontBase64("/fonts/DejaVuSans-Bold.ttf")]);
  const L = T[getLang()];
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.addFileToVFS("DejaVuSans.ttf", regular); doc.addFont("DejaVuSans.ttf", "DejaVu", "normal");
  doc.addFileToVFS("DejaVuSans-Bold.ttf", bold); doc.addFont("DejaVuSans-Bold.ttf", "DejaVu", "bold");
  doc.setFont("DejaVu", "normal");
  const W = doc.internal.pageSize.getWidth(), M = 14;
  const now = new Date().toLocaleString(getLang() === "en" ? "en-GB" : "ro-RO");

  opts.sheets.forEach((s, idx) => {
    if (idx > 0) doc.addPage();
    const firstPage = doc.getNumberOfPages();
    doc.setFont("DejaVu", "bold"); doc.setFontSize(9); doc.setTextColor(120);
    doc.text(opts.companyName, M, 14);
    doc.setTextColor(20); doc.setFontSize(16);
    doc.text(L.title, M, 22);
    doc.setFontSize(10); doc.setFont("DejaVu", "normal");
    doc.text(`${L.employee}: `, M, 30); doc.setFont("DejaVu", "bold"); doc.text(s.employee.full_name, M + doc.getTextWidth(`${L.employee}: `), 30);
    doc.setFont("DejaVu", "normal");
    if (s.employee.trade) doc.text(`${L.trade}: ${s.employee.trade}`, M, 35);
    doc.text(`${L.month}: ${monthLabel(s.month)}`, W - M, 30, { align: "right" });

    const body: (string | { content: string; styles?: Record<string, unknown> })[][] = [];
    const weekend: number[] = [];
    for (const d of s.days) {
      const date = `${d.date.slice(8, 10)}.${d.date.slice(5, 7)}`;
      const wd = L.days[d.weekday];
      if (d.lines.length === 0) {
        if (d.weekday >= 6) weekend.push(body.length);
        body.push([date, wd, d.absence ? L.absence[d.absence] : "", "", "", "", ""]);
        continue;
      }
      d.lines.forEach((l, i) => {
        if (d.weekday >= 6) weekend.push(body.length);
        body.push([
          i === 0 ? date : "", i === 0 ? wd : "",
          (l.task ? `${l.project} — ${l.task}` : l.project) + (l.byButton ? " ✓" : ""),
          `${l.start}–${l.end}`, l.breakMinutes ? `${l.breakMinutes} min` : "", decimalHours(l.minutes), L.status[l.status],
        ]);
      });
    }
    autoTable(doc, {
      startY: 40,
      head: [L.cols],
      body,
      margin: { left: M, right: M, bottom: 18 },
      styles: { font: "DejaVu", fontSize: 8, cellPadding: 1.2, lineColor: 220, lineWidth: 0.1 },
      headStyles: { fillColor: [234, 88, 12], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: 255 },
      columnStyles: { 0: { cellWidth: 13 }, 1: { cellWidth: 10 }, 3: { cellWidth: 22 }, 4: { cellWidth: 15 }, 5: { cellWidth: 12, halign: "right" }, 6: { cellWidth: 20 } },
      didParseCell: (h) => { if (h.section === "body" && weekend.includes(h.row.index)) h.cell.styles.fillColor = [236, 236, 236]; },
    });

    // totaluri
    let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    if (y > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = 20; }
    const abs = Object.entries(s.absenceDays).map(([k, n]) => `${L.absence[k as AbsenceType]}: ${n}`).join(", ") || L.none;
    const totals: [string, string][] = [
      [L.approved, `${decimalHours(s.approvedMinutes)} (${formatMinutes(s.approvedMinutes)})`],
      [L.submitted, `${decimalHours(s.submittedMinutes)} (${formatMinutes(s.submittedMinutes)})`],
      [L.total, decimalHours(s.approvedMinutes + s.submittedMinutes)],
      [L.workedDays, String(s.workedDays)],
      [L.absences, abs],
    ];
    doc.setFontSize(10);
    totals.forEach(([k, v], i) => {
      doc.setFont("DejaVu", i === 0 ? "bold" : "normal"); doc.text(k, M, y + i * 5.5);
      doc.text(v, M + 70, y + i * 5.5);
    });
    y += totals.length * 5.5 + 2;
    doc.setFont("DejaVu", "normal"); doc.setFontSize(7.5); doc.setTextColor(110);
    doc.text(doc.splitTextToSize(L.note, W - 2 * M), M, y);
    doc.setTextColor(20); doc.setFontSize(9);
    y += 22;
    doc.line(M, y, M + 70, y); doc.line(W - M - 70, y, W - M, y);
    doc.text(L.sigEmployee, M, y + 5); doc.text(L.sigAdmin, W - M - 70, y + 5);

    // subsol pe fiecare pagină a angajatului
    const last = doc.getNumberOfPages();
    for (let p = firstPage; p <= last; p++) {
      doc.setPage(p); doc.setFontSize(7); doc.setTextColor(140);
      const h = doc.internal.pageSize.getHeight();
      doc.text(`DYASPlanning · ${L.generated} ${now}`, M, h - 8);
      doc.text(`${s.employee.full_name} · ${L.page} ${p - firstPage + 1}/${last - firstPage + 1}`, W - M, h - 8, { align: "right" });
      doc.setTextColor(20);
    }
    doc.setPage(last);
  });
  return doc.output("blob");
}

export function saveBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Pe telefon: deschide meniul de trimitere (WhatsApp, e-mail) cu fișierul; altfel îl descarcă. */
export async function shareOrSave(filename: string, blob: Blob, title: string): Promise<void> {
  const file = new File([blob], filename, { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try { await nav.share({ files: [file], title }); return; } catch (e) { if ((e as Error).name === "AbortError") return; }
  }
  saveBlob(filename, blob);
}
