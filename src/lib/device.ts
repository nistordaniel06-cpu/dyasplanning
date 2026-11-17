/** Descriere scurtă a dispozitivului din User-Agent, de ex. „Android · Chrome”. */
export function deviceLabel(ua: string): string {
  const os = /DYASPlanning Android/i.test(ua) ? "Aplicația Android"
    : /iPhone|iPad|iPod/i.test(ua) ? (/iPad/i.test(ua) ? "iPad" : "iPhone")
    : /Android/i.test(ua) ? "Android"
    : /Windows/i.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/i.test(ua) ? "Mac"
    : /Linux/i.test(ua) ? "Linux" : "Alt dispozitiv";
  const br = /SamsungBrowser/i.test(ua) ? "Samsung Internet"
    : /MiuiBrowser|XiaoMi/i.test(ua) ? "Mi Browser"
    : /EdgA?\//i.test(ua) ? "Edge"
    : /OPR\/|Opera/i.test(ua) ? "Opera"
    : /Firefox|FxiOS/i.test(ua) ? "Firefox"
    : /CriOS|Chrome\//i.test(ua) ? "Chrome"
    : /Safari/i.test(ua) ? "Safari" : "";
  return br ? `${os} · ${br}` : os;
}
