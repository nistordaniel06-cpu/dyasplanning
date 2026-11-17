const ts = require(require("path").resolve(__dirname, "../../node_modules/typescript"));
const fs = require("fs"), path = require("path");
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(tsx|ts)$/.test(f) && !/\.test\./.test(f)) files.push(p); } })(require("path").resolve(__dirname, "../../src"));
const out = new Map(); const tpl = new Map();
const human = (s) => {
  const t = s.trim();
  if (t.length < 2 || !/[a-zA-ZăâîșțĂÂÎȘȚ]/.test(t)) return false;
  if (/^(\/|https?:|mailto:|#|\.|@)/.test(t)) return false;
  if (/^[a-z0-9_.:\-\/\[\]&>=()%!]+$/.test(t)) return false; // identificatori, clase simple
  if (/\b(px|py|mt|mb|ml|mr|pl|pr|text|bg|border|rounded|flex|grid|gap|w|h|min|max|items|justify|font|shadow|hidden|block|inline|space|divide|truncate|absolute|relative|fixed|inset|top|left|right|bottom|z|opacity|ring|focus|hover|md|sm|lg|col|row|shrink|overflow|whitespace|leading|tracking|p|m)-/.test(t) && !/[ăâîșț]/.test(t)) return false;
  if (/^[A-Z_]+$/.test(t)) return false;
  if (/^(Europe|Asia|America)\//.test(t)) return false;
  if (/^(select|insert|update|delete)\b/i.test(t)) return false;
  return true;
};
for (const f of files) {
  const src = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  (function visit(n) {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isCallExpression(n) && /^(rpc|from|select|eq|order|is|in|getItem|setItem|removeItem|addEventListener|channel|on|querySelector|startsWith|includes|endsWith|split|replace|toLocaleString|toLocaleDateString|toLocaleTimeString|format|formatInTimeZone|registerPlugin|get|postMessage)$/.test(n.expression.name?.text ?? n.expression.text ?? "")) {
      // argumentele acestor apeluri nu sunt text pentru utilizator (ex. rpc("nume"))
      n.arguments.slice(1).forEach(visit); if (n.expression) visit(n.expression); return;
    }
    if (ts.isJsxAttribute(n) && ["className", "href", "key", "type", "name", "id", "inputMode", "autoComplete", "role", "variant", "size", "tone", "src", "rel", "target", "value", "form", "htmlFor", "pattern", "accept", "method"].includes(n.name.text)) return;
    if (ts.isPropertyAssignment(n) && ["className", "tone", "href", "icon", "value", "code", "dial", "event", "schema", "table", "filter", "status", "kind", "key", "variant"].includes(n.name?.text)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) { if (human(n.text)) out.set(n.text.trim(), (out.get(n.text.trim()) || []).concat(path.basename(f))); }
    else if (ts.isJsxText(n)) { const t = n.text.replace(/\s+/g, " ").trim(); if (t && /[a-zA-ZăâîșțĂÂÎȘȚ]/.test(t)) out.set(t, (out.get(t) || []).concat(path.basename(f))); }
    else if (ts.isTemplateExpression(n)) {
      let s = n.head.text; n.templateSpans.forEach((sp, i) => { s += "{" + i + "}" + sp.literal.text; });
      if (/[a-zA-ZăâîșțĂÂÎȘȚ]{2}/.test(s.replace(/\{\d\}/g, "")) && / /.test(s)) tpl.set(s.trim(), path.basename(f));
      n.templateSpans.forEach((sp) => visit(sp.expression)); return;
    }
    ts.forEachChild(n, visit);
  })(src);
}
fs.writeFileSync(require("path").join(__dirname, "strings.json"), JSON.stringify([...out.keys()].sort(), null, 1));
fs.writeFileSync(require("path").join(__dirname, "templates.json"), JSON.stringify([...tpl.keys()].sort(), null, 1));
console.log("strings", out.size, "templates", tpl.size);
