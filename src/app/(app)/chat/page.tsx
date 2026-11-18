"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, ImagePlus, Hammer, MessageCirclePlus, Mic, Send, Square, Trash2, Users, User as UserIcon } from "lucide-react";
import { compressImage, extFor, newId, signedUrls, upload } from "@/lib/media";
import { Button, Empty, ErrorBox, Loading, Modal, PageHeader, cx } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useQuery, must } from "@/lib/useQuery";
import { useUnread } from "@/lib/unread";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { ROLE_LABEL } from "@/lib/labels";
import { fmt, localDate, todayIn } from "@/lib/time";
import type { AppRole } from "@/lib/types";

interface Channel { id: string; kind: "general" | "project" | "direct"; name: string | null; project_id: string | null; color: string | null; last_body: string | null; last_author: string | null; last_at: string | null; unread: number }
interface Message {
  id: string; channel_id: string; user_id: string; author_name: string | null; body: string; created_at: string;
  attachment_path?: string | null; attachment_type?: "image" | "audio" | null; attachment_duration?: number | null;
}
const PLACEHOLDER = new Set(["📷 Poză", "🎤 Mesaj vocal"]);
interface Contact { user_id: string; name: string; role: AppRole; trade: string | null }

export default function ChatPage() {
  return <Suspense fallback={<Loading />}><Chat /></Suspense>;
}

function ChannelIcon({ c }: { c: Channel }) {
  const Icon = c.kind === "general" ? Users : c.kind === "project" ? Hammer : UserIcon;
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white" style={{ background: c.kind === "project" ? (c.color ?? "#64748b") : c.kind === "general" ? "#ea580c" : "#334155" }}>
      <Icon className="h-5 w-5" />
    </span>
  );
}

function Chat() {
  const { tz } = useSession();
  const unread = useUnread();
  const params = useSearchParams();
  const router = useRouter();
  const current = params.get("c");
  const [newOpen, setNewOpen] = useState(false);

  const channels = useQuery(async () => must(await supabase().rpc("my_chat_channels")) as Channel[], []);
  useEffect(() => {
    const t = setInterval(() => void channels.reload(), 15000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const list = channels.data ?? [];
  const selected = list.find((c) => c.id === current) ?? null;
  const open = (id: string) => router.push(`/chat?c=${id}`);

  return (
    <div className="md:flex md:h-[calc(100dvh-5rem)] md:gap-4">
      <div className={cx("md:flex md:w-80 md:shrink-0 md:flex-col", current && "hidden md:flex")}>
        <PageHeader title="Chat" actions={<Button size="sm" onClick={() => setNewOpen(true)}><MessageCirclePlus className="h-4 w-4" />Mesaj privat</Button>} />
        {channels.error && <ErrorBox message={channels.error} onRetry={channels.reload} />}
        {channels.loading && !channels.data && <Loading />}
        <ul className="space-y-1 md:flex-1 md:overflow-y-auto">
          {list.map((c) => (
            <li key={c.id}>
              <button onClick={() => open(c.id)}
                className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left", c.id === current ? "bg-orange-50 ring-1 ring-orange-300" : "hover:bg-white")}>
                <ChannelIcon c={c} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cx("truncate", c.unread ? "font-bold" : "font-semibold")}>{c.name ?? "Conversație"}</span>
                    {c.last_at && <span className="shrink-0 text-[11px] text-slate-500">{localDate(c.last_at, tz) === todayIn(tz) ? fmt(c.last_at, tz, "HH:mm") : fmt(c.last_at, tz, "dd.MM")}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={cx("truncate text-sm", c.unread ? "text-slate-900" : "text-slate-500")}>
                      {c.last_body ? `${c.kind !== "direct" && c.last_author ? c.last_author.split(" ")[0] + ": " : ""}${c.last_body}` : c.kind === "project" ? "Grupul lucrării" : c.kind === "general" ? "Grupul întregii firme" : "Conversație privată"}
                    </span>
                    {c.unread > 0 && <span className="ml-auto rounded-full bg-orange-600 px-1.5 text-[11px] font-bold leading-5 text-white">{c.unread}</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {current ? (
        <Conversation key={current} channelId={current} channel={selected} onRead={() => { void channels.reload(); unread.refresh(); }} />
      ) : (
        <div className="hidden flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-300 text-sm text-slate-500 md:flex">Alege o conversație</div>
      )}

      {newOpen && <NewChat onClose={() => setNewOpen(false)} onOpen={(id) => { setNewOpen(false); void channels.reload(); open(id); }} />}
    </div>
  );
}

function Conversation({ channelId, channel, onRead }: { channelId: string; channel: Channel | null; onRead: () => void }) {
  const { user, tz, company } = useSession();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [recording, setRecording] = useState<{ rec: MediaRecorder; started: number } | null>(null);
  const [recSecs, setRecSecs] = useState(0);
  const [viewer, setViewer] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelRec = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const lastId = useRef<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase().from("chat_messages").select("*").eq("channel_id", channelId).order("created_at", { ascending: false }).limit(200);
    if (error) { setError(humanError(error)); return; }
    const msgs = (data as Message[]).reverse();
    const paths = msgs.map((m) => m.attachment_path).filter((x): x is string => !!x);
    if (paths.length) void signedUrls("chat", paths).then((u) => setUrls((old) => ({ ...old, ...u })));
    setMessages(msgs);
    const newest = msgs[msgs.length - 1]?.id ?? null;
    if (newest !== lastId.current) {
      lastId.current = newest;
      await supabase().rpc("mark_chat_read", { p_channel: channelId });
      onRead();
      setTimeout(() => bottom.current?.scrollIntoView({ block: "end" }), 30);
    }
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    const ch = supabase().channel(`chat-${channelId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `channel_id=eq.${channelId}` }, () => void load())
      .subscribe();
    return () => { clearInterval(t); void supabase().removeChannel(ch); };
  }, [load, channelId]);

  async function sendAttachment(blob: Blob, type: "image" | "audio", duration?: number) {
    setSending(true); setError(null);
    try {
      const path = `${company!.id}/${channelId}/${newId()}.${extFor(blob.type)}`;
      await upload("chat", path, blob);
      const { error } = await supabase().from("chat_messages").insert({
        channel_id: channelId, body: type === "image" ? text.trim() : "", attachment_path: path, attachment_type: type, attachment_duration: duration ?? null,
      });
      if (error) throw error;
      if (type === "image") setText("");
      await load();
    } catch (e) { setError(humanError(e)); }
    setSending(false);
  }

  async function pickPhoto(files: FileList | null) {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith("image/")).slice(0, 10);
    if (photoInput.current) photoInput.current.value = "";
    if (galleryInput.current) galleryInput.current.value = "";
    // mai multe poze din galerie: câte un mesaj pentru fiecare, în ordine
    for (const f of list) await sendAttachment(await compressImage(f), "image");
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"].find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = []; cancelRec.current = false;
      rec.ondataavailable = (ev) => { if (ev.data.size) chunks.current.push(ev.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
        setRecording(null);
        if (cancelRec.current || !chunks.current.length) return;
        void sendAttachment(new Blob(chunks.current, { type: (rec.mimeType || mime || "audio/webm").split(";")[0] }), "audio", secs);
      };
      const started = Date.now();
      rec.start();
      setRecording({ rec, started }); setRecSecs(0);
    } catch {
      setError("Nu am acces la microfon. Permite microfonul pentru acest site din setările telefonului.");
    }
  }
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      const s = Math.round((Date.now() - recording.started) / 1000);
      setRecSecs(s);
      if (s >= 180) recording.rec.stop(); // maximum 3 minute
    }, 250);
    return () => clearInterval(t);
  }, [recording]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true); setError(null);
    const { error } = await supabase().from("chat_messages").insert({ channel_id: channelId, body });
    setSending(false);
    if (error) { setError(humanError(error)); return; }
    setText("");
    await load();
  }

  return (
    <section className="fixed inset-0 z-50 flex flex-col bg-slate-50 md:static md:z-auto md:flex-1 md:overflow-hidden md:rounded-2xl md:border md:border-slate-200 md:bg-white">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
        <Link href="/chat" className="rounded-lg p-2 hover:bg-slate-100 md:hidden" aria-label="Înapoi"><ArrowLeft className="h-5 w-5" /></Link>
        {channel && <ChannelIcon c={channel} />}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{channel?.name ?? "Conversație"}</div>
          <div className="text-xs text-slate-500">{channel?.kind === "general" ? "Toți din firmă" : channel?.kind === "project" ? "Oamenii alocați pe lucrare + administratorii" : "Conversație privată"}</div>
        </div>
        {channel?.kind === "project" && channel.project_id && <Link href={`/lucrari/${channel.project_id}`} className="hidden text-sm font-semibold text-orange-700 md:block">Lucrarea →</Link>}
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {messages === null && !error && <Loading />}
        {messages?.length === 0 && <Empty title="Niciun mesaj încă">Scrie primul mesaj.</Empty>}
        {messages?.map((m, i) => {
          const mine = m.user_id === user.id;
          const prev = messages[i - 1];
          const newDay = !prev || localDate(prev.created_at, tz) !== localDate(m.created_at, tz);
          const showAuthor = !mine && channel?.kind !== "direct" && (!prev || prev.user_id !== m.user_id || newDay);
          return (
            <div key={m.id}>
              {newDay && <div className="my-3 text-center text-xs font-semibold text-slate-500">{localDate(m.created_at, tz) === todayIn(tz) ? "Azi" : fmt(m.created_at, tz, "EEEE, d MMMM")}</div>}
              <div className={cx("flex", mine ? "justify-end" : "justify-start")}>
                <div className={cx("max-w-[80%] rounded-2xl px-3 py-2 text-[15px] shadow-sm", mine ? "rounded-br-sm bg-orange-600 text-white" : "rounded-bl-sm bg-white text-slate-900 ring-1 ring-slate-200")}>
                  {showAuthor && <div className="mb-0.5 text-xs font-semibold text-orange-700">{m.author_name}</div>}
                  {m.attachment_type === "image" && m.attachment_path && (
                    urls[m.attachment_path]
                      ? <button type="button" onClick={() => setViewer(urls[m.attachment_path!])} className="-mx-1 mb-1 block overflow-hidden rounded-xl">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={urls[m.attachment_path]} alt="Poză" className="max-h-72 w-full object-cover" loading="lazy" />
                        </button>
                      : <div className="mb-1 h-40 w-56 animate-pulse rounded-xl bg-black/10" />
                  )}
                  {m.attachment_type === "audio" && m.attachment_path && (
                    <div className="mb-1 flex items-center gap-2">
                      <Mic className="h-4 w-4 shrink-0 opacity-80" />
                      {urls[m.attachment_path] ? <audio controls preload="metadata" src={urls[m.attachment_path]} className="h-10 w-56 max-w-full" /> : <span className="text-sm opacity-80">…</span>}
                      {m.attachment_duration ? <span className="text-xs opacity-80">{Math.floor(m.attachment_duration / 60)}:{String(m.attachment_duration % 60).padStart(2, "0")}</span> : null}
                    </div>
                  )}
                  {!(m.attachment_path && PLACEHOLDER.has(m.body)) && <div data-no-i18n className="whitespace-pre-wrap break-words">{m.body}</div>}
                  <div className={cx("mt-0.5 text-right text-[10px]", mine ? "text-orange-100" : "text-slate-400")}>{fmt(m.created_at, tz, "HH:mm")}</div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      {error && <div className="px-3"><ErrorBox message={error} /></div>}
      <Modal open={!!viewer} onClose={() => setViewer(null)} title="Poză" wide>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {viewer && <img src={viewer} alt="Poză" className="mx-auto max-h-[75vh] w-auto rounded-lg" />}
      </Modal>
      {recording ? (
        <div className="flex items-center gap-3 border-t border-slate-200 bg-white p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <button type="button" aria-label="Anulează înregistrarea" onClick={() => { cancelRec.current = true; recording.rec.stop(); }} className="rounded-full p-3 text-slate-500 hover:bg-slate-100"><Trash2 className="h-5 w-5" /></button>
          <div className="flex flex-1 items-center gap-2 font-semibold text-red-700"><span className="h-3 w-3 animate-pulse rounded-full bg-red-600" />Se înregistrează… {Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, "0")}</div>
          <Button type="button" variant="primary" className="h-11 rounded-full px-4" onClick={() => recording.rec.stop()}><Square className="h-4 w-4" />Trimite</Button>
        </div>
      ) : (
      <form onSubmit={send} className="flex items-end gap-2 border-t border-slate-200 bg-white p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <button type="button" aria-label="Fă o poză" disabled={sending} onClick={() => photoInput.current?.click()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"><Camera className="h-5 w-5" /></button>
        <input ref={photoInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void pickPhoto(e.target.files)} />
        <button type="button" aria-label="Încarcă poze din galerie" disabled={sending} onClick={() => galleryInput.current?.click()} className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"><ImagePlus className="h-5 w-5" /></button>
        <input ref={galleryInput} type="file" accept="image/*" multiple hidden onChange={(e) => void pickPhoto(e.target.files)} data-testid="chat-galerie" />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={4000} placeholder="Scrie un mesaj…"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(min-width: 768px)").matches) { e.preventDefault(); void send(e); } }}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-slate-300 px-4 py-2.5 text-base focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200" />
        {text.trim()
          ? <Button type="submit" variant="primary" className="h-11 w-11 rounded-full p-0" loading={sending} aria-label="Trimite"><Send className="h-5 w-5" /></Button>
          : <Button type="button" variant="primary" className="h-11 w-11 rounded-full p-0" loading={sending} onClick={startRecording} aria-label="Mesaj vocal"><Mic className="h-5 w-5" /></Button>}
      </form>
      )}
    </section>
  );
}

function NewChat({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const q = useQuery(async () => must(await supabase().rpc("chat_contacts")) as Contact[], []);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  async function start(c: Contact) {
    const { data, error } = await supabase().rpc("open_direct_chat", { p_user: c.user_id });
    if (error) { setError(humanError(error)); return; }
    onOpen(data as string);
  }
  const list = (q.data ?? []).filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <Modal open onClose={onClose} title="Mesaj privat" footer={<Button onClick={onClose}>Închide</Button>}>
      <input className="mb-3 h-11 w-full rounded-lg border border-slate-300 px-3" placeholder="Caută o persoană" value={search} onChange={(e) => setSearch(e.target.value)} />
      {q.loading && <Loading />}
      {q.error && <ErrorBox message={q.error} />}
      {q.data && q.data.length === 0 && <p className="text-sm text-slate-600">Nu mai există alte persoane cu acces în aplicație.</p>}
      <ul className="divide-y divide-slate-100">
        {list.map((c) => (
          <li key={c.user_id}>
            <button className="flex w-full items-center gap-3 py-3 text-left hover:bg-slate-50" onClick={() => start(c)}>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-bold">{c.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span>
              <span className="flex-1"><span className="block font-semibold">{c.name}</span><span className="text-xs text-slate-500">{ROLE_LABEL[c.role]}{c.trade ? ` · ${c.trade}` : ""}</span></span>
            </button>
          </li>
        ))}
      </ul>
      {error && <ErrorBox message={error} />}
    </Modal>
  );
}
