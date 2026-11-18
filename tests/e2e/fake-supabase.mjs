// Stand-in local pentru API-urile Supabase folosite de aplicație (REST tip PostgREST + Auth tip GoTrue).
// Fiecare cerere rulează în Postgres ca rol `authenticated` cu request.jwt.claim.sub = id-ul utilizatorului,
// exact ca PostgREST, deci RLS, trigger-ele și constrângerile din schema reală se aplică integral.
import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";

const PORT = Number(process.env.PORT ?? 54321);
const SECRET = "e2e-secret";
// Formate identice cu PostgREST: date → "YYYY-MM-DD", timestamptz → "YYYY-MM-DDTHH:MM:SS[.ffffff]+00:00".
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1184, (v) => v.replace(" ", "T").replace(/\+00$/, "+00:00"));
pg.types.setTypeParser(1114, (v) => v.replace(" ", "T"));
const pool = new pg.Pool({ host: "/tmp", port: 5433, user: "postgres", database: process.env.DB ?? "dyas_e2e", max: 8 });

const b64u = (b) => Buffer.from(b).toString("base64url");
function signJwt(payload) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  const s = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}
function verifyJwt(tok) {
  const [h, p, s] = (tok ?? "").split(".");
  if (!s) return null;
  const exp = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  if (exp !== s) return null;
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  if (payload.exp && payload.exp < Date.now() / 1000) return null;
  return payload;
}
export const ANON_KEY = signJwt({ role: "anon", iss: "e2e", iat: 1700000000 });

const refreshTokens = new Map();
function session(user) {
  const now = Math.floor(Date.now() / 1000);
  const access = signJwt({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600, session_id: crypto.randomUUID() });
  const refresh = crypto.randomBytes(16).toString("hex");
  refreshTokens.set(refresh, user.id);
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userObj(user) };
}
const userObj = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.created_at, phone: "", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [], created_at: u.created_at, updated_at: u.created_at });

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...cors, ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, prefer, accept-profile, content-profile, x-supabase-api-version, range, x-upsert, cache-control, x-metadata, x-retry-count",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS, PUT",
  "Access-Control-Expose-Headers": "content-range",
};
const readBody = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d ? JSON.parse(d) : null)); });
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error(`identificator invalid: ${s}`), { code: "PGRST100" }); return `"${s}"`; };

function pgError(res, e) {
  const status = e.code === "42501" ? 403 : e.code === "23505" || e.code === "23P01" || e.code === "23503" ? 409 : e.code === "PGRST116" ? 406 : 400;
  send(res, status, { code: e.code ?? "XX000", message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
}

async function withRole(sub, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local timezone = 'UTC'");
    await c.query(sub ? "set local role authenticated" : "set local role anon");
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [sub ?? ""]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally { c.release(); }
}

// Filtre PostgREST: col=op.value
function buildWhere(params, args) {
  const parts = [];
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "columns", "on_conflict"].includes(k)) continue;
    const m = v.match(/^(eq|neq|gt|gte|lt|lte|in|is|like|ilike)\.(.*)$/s);
    if (!m) throw Object.assign(new Error(`filtru nesuportat ${k}=${v}`), { code: "PGRST100" });
    const [, op, raw] = m;
    const col = ident(k);
    if (op === "in") {
      const vals = raw.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, ""));
      args.push(vals); parts.push(`${col}::text = any($${args.length}::text[])`);
    } else if (op === "is") {
      parts.push(`${col} is ${raw === "null" ? "null" : raw === "true" ? "true" : "false"}`);
    } else {
      const sqlop = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike" }[op];
      args.push(raw); parts.push(`${col} ${sqlop} $${args.length}`);
    }
  }
  return parts.length ? ` where ${parts.join(" and ")}` : "";
}
function buildOrder(params) {
  const o = params.get("order");
  if (!o) return "";
  return " order by " + o.split(",").map((x) => {
    const [c, dir, nulls] = x.split(".");
    return `${ident(c)} ${dir === "desc" ? "desc" : "asc"}${nulls === "nullslast" ? " nulls last" : nulls === "nullsfirst" ? " nulls first" : ""}`;
  }).join(", ");
}

async function rest(req, res, url, sub) {
  const path = url.pathname.replace(/^\/rest\/v1\//, "");
  const params = url.searchParams;
  const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  const prefer = req.headers.prefer ?? "";
  const returnRep = prefer.includes("return=representation");
  const body = await readBody(req);

  const result = await withRole(sub, async (c) => {
    if (path.startsWith("rpc/")) {
      const fn = ident(path.slice(4));
      const keys = Object.keys(body ?? {});
      const args = keys.map((k) => body[k]);
      const named = keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ");
      const info = await c.query("select p.proretset, t.typname, t.typtype from pg_proc p join pg_type t on t.oid = p.prorettype where p.proname = $1 and p.pronamespace = 'public'::regnamespace limit 1", [path.slice(4)]);
      const r0 = info.rows[0];
      if (!r0) throw Object.assign(new Error("funcție inexistentă"), { code: "PGRST202" });
      if (r0.proretset) { const r = await c.query(`select * from ${fn}(${named})`, args); return { rows: r.rows, array: true }; }
      const r = await c.query(`select ${fn}(${named}) as v`, args);
      return { scalar: r0.typname === "void" ? null : r.rows[0].v };
    }
    const table = ident(path);
    const args = [];
    if (req.method === "GET") {
      const r = await c.query(`select * from ${table}${buildWhere(params, args)}${buildOrder(params)}${params.get("limit") ? ` limit ${Number(params.get("limit"))}` : ""}`, args);
      return { rows: r.rows };
    }
    if (req.method === "POST") {
      const rows = Array.isArray(body) ? body : [body];
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const colList = cols.map(ident).join(", ");
      args.push(JSON.stringify(rows));
      const r = await c.query(`insert into ${table} (${colList}) select ${colList} from json_populate_recordset(null::${table}, $1::json) returning *`, args);
      return { rows: r.rows, created: true };
    }
    if (req.method === "PATCH") {
      const cols = Object.keys(body);
      args.push(JSON.stringify(body));
      const set = cols.map((k) => `${ident(k)} = (json_populate_record(null::${table}, $1::json)).${ident(k)}`).join(", ");
      const r = await c.query(`update ${table} set ${set}${buildWhere(params, args)} returning *`, args);
      return { rows: r.rows };
    }
    if (req.method === "DELETE") {
      const r = await c.query(`delete from ${table}${buildWhere(params, args)} returning *`, args);
      return { rows: r.rows };
    }
    throw Object.assign(new Error("metodă nesuportată"), { code: "PGRST000" });
  });

  if ("scalar" in result) return send(res, 200, result.scalar);
  if (result.array) return send(res, 200, result.rows);
  const isWrite = req.method !== "GET";
  if (isWrite && !returnRep) return send(res, result.created ? 201 : 204);
  if (wantsObject) {
    if (result.rows.length !== 1) return pgError(res, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", detail: `The result contains ${result.rows.length} rows` });
    return send(res, isWrite && result.created ? 201 : 200, result.rows[0]);
  }
  return send(res, result.created ? 201 : 200, result.rows);
}

async function auth(req, res, url, bearer) {
  const p = url.pathname.replace(/^\/auth\/v1/, "");
  const body = req.method === "GET" ? null : await readBody(req);
  const c = await pool.connect();
  try {
    if (p === "/signup") {
      const exists = await c.query("select 1 from auth.users where lower(email) = lower($1)", [body.email]);
      if (exists.rowCount) return send(res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered", message: "User already registered" });
      if ((body.password ?? "").length < 6) return send(res, 422, { code: 422, error_code: "weak_password", msg: "Password should be at least 6 characters.", message: "Password should be at least 6 characters." });
      const id = crypto.randomUUID();
      await c.query("insert into auth.users(id, email, encrypted_password, email_confirmed_at) values ($1, $2, extensions.crypt($3, extensions.gen_salt('bf')), now())", [id, body.email.toLowerCase(), body.password]);
      return send(res, 200, session({ id, email: body.email.toLowerCase(), created_at: new Date().toISOString() }));
    }
    if (p === "/token") {
      const gt = url.searchParams.get("grant_type");
      if (gt === "password") {
        const r = await c.query("select u.id, u.email from auth.users u where lower(u.email) = lower($1) and u.encrypted_password = extensions.crypt($2, u.encrypted_password)", [body.email, body.password ?? ""]);
        if (!r.rowCount) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials", error: "invalid_grant", error_description: "Invalid login credentials" });
        return send(res, 200, session({ ...r.rows[0], created_at: new Date().toISOString() }));
      }
      if (gt === "refresh_token") {
        const uid = refreshTokens.get(body.refresh_token);
        if (!uid) return send(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
        const r = await c.query("select id, email from auth.users where id = $1", [uid]);
        return send(res, 200, session({ ...r.rows[0], created_at: new Date().toISOString() }));
      }
    }
    if (p === "/user" && req.method === "PUT") {
      const claims = verifyJwt(bearer);
      if (!claims?.sub) return send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      if (body?.password) await c.query("update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')) where id = $1", [claims.sub, body.password]);
      const r = await c.query("select id, email from auth.users where id = $1", [claims.sub]);
      return send(res, 200, userObj({ ...r.rows[0], created_at: new Date().toISOString() }));
    }
    if (p === "/user") {
      const claims = verifyJwt(bearer);
      if (!claims?.sub) return send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      const r = await c.query("select id, email from auth.users where id = $1", [claims.sub]);
      if (!r.rowCount) return send(res, 403, { code: 403, error_code: "user_not_found", msg: "User not found" });
      return send(res, 200, userObj({ ...r.rows[0], created_at: new Date().toISOString() }));
    }
    if (p === "/logout") return send(res, 204);
    return send(res, 404, { msg: `auth endpoint ${p} nesuportat` });
  } finally { c.release(); }
}

// Storage (tip Supabase Storage): încărcarea trece prin RLS-ul real pe storage.objects; fișierele stau în memorie.
const files = new Map(); // "bucket/path" -> { type, data }
const readRaw = (req) => new Promise((r) => { const ch = []; req.on("data", (c) => ch.push(c)); req.on("end", () => r(Buffer.concat(ch))); });
async function storage(req, res, url, sub) {
  const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ""));
  let m;
  if (req.method === "GET" && (m = p.match(/^\/object\/sign\/([^/]+)\/(.+)$/))) {
    const f = files.get(`${m[1]}/${m[2]}`);
    if (!f || url.searchParams.get("token") !== "ok") return send(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
    res.writeHead(200, { "Content-Type": f.type, ...cors }); return res.end(f.data);
  }
  if (req.method === "POST" && (m = p.match(/^\/object\/sign\/([^/]+)$/))) {
    const body = await readBody(req);
    const out = await withRole(sub, async (c) => {
      const r = await c.query("select name from storage.objects where bucket_id = $1 and name = any($2)", [m[1], body.paths]);
      const ok = new Set(r.rows.map((x) => x.name));
      return body.paths.map((path) => ok.has(path)
        ? { error: null, path, signedURL: `/object/sign/${m[1]}/${path}?token=ok` }
        : { error: "Either the object does not exist or you do not have access to it", path, signedURL: null });
    });
    return send(res, 200, out);
  }
  if ((req.method === "POST" || req.method === "PUT") && (m = p.match(/^\/object\/([^/]+)\/(.+)$/))) {
    let data = await readRaw(req);
    let type = (req.headers["content-type"] ?? "application/octet-stream").split(";")[0];
    if (type === "multipart/form-data") {
      // supabase-js trimite FormData când primește File/Blob în browser
      const boundary = req.headers["content-type"].split("boundary=")[1];
      const parts = data.toString("latin1").split(`--${boundary}`);
      const part = parts.find((x) => x.includes('name=""') || x.includes("filename=")) ?? parts[1];
      const [head, ...rest] = part.split("\r\n\r\n");
      type = (head.match(/Content-Type: ([^\r\n;]+)/i) ?? [])[1] ?? "application/octet-stream";
      data = Buffer.from(rest.join("\r\n\r\n").replace(/\r\n$/, ""), "latin1");
    }
    await withRole(sub, (c) => c.query("insert into storage.objects(bucket_id, name, metadata) values ($1, $2, $3)", [m[1], m[2], { mimetype: type, size: data.length }]));
    files.set(`${m[1]}/${m[2]}`, { type, data });
    return send(res, 200, { Id: crypto.randomUUID(), Key: `${m[1]}/${m[2]}` });
  }
  return send(res, 404, { msg: `storage ${req.method} ${p} nesuportat` });
}

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer /i, "");
  try {
    if (url.pathname.startsWith("/auth/v1")) return await auth(req, res, url, bearer);
    if (url.pathname.startsWith("/rest/v1")) {
      const claims = verifyJwt(bearer);
      return await rest(req, res, url, claims?.sub ?? null);
    }
    if (url.pathname.startsWith("/storage/v1")) return await storage(req, res, url, verifyJwt(bearer)?.sub ?? null);
    send(res, 404, { msg: "not found" });
  } catch (e) {
    if (process.env.DEBUG) console.error(req.method, req.url, e.message);
    pgError(res, e);
  }
}).listen(PORT, () => console.log(`fake-supabase pe :${PORT}\nANON_KEY=${ANON_KEY}`));
