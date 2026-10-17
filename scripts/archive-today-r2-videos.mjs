/**
 * Lista videos R2 del día (por LastModified o stamp en key) y los archiva en Desktop\video2.
 * Uso: node scripts/archive-today-r2-videos.mjs [YYYY-MM-DD]
 */
import { createHash, createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { config } from "../src/config.mjs";
import { publicR2Url } from "../src/r2.mjs";
import {
  VIDEO_ARCHIVE_DIR,
  archiveProducedVideo,
  rememberArchivedUrl,
} from "../src/video-archive.mjs";

const REGION = "auto";
const SERVICE = "s3";
const sha256Hex = (d) => createHash("sha256").update(d).digest("hex");
const hmac = (k, d) => createHmac("sha256", k).update(d).digest();

function signingKey(secret, dateStamp) {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

async function listPrefix(prefix, token) {
  const cfg = config.r2;
  const endpoint = new URL(cfg.endpoint);
  const host = endpoint.host;
  let qs = `list-type=2&max-keys=1000&prefix=${encodeURIComponent(prefix)}`;
  if (token) qs += `&continuation-token=${encodeURIComponent(token)}`;
  const canonicalUri = `/${cfg.bucket}`;
  const iso = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const amzDate = `${iso.slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex("");
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "GET",
    canonicalUri,
    qs,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = createHmac("sha256", signingKey(cfg.secretAccessKey, dateStamp))
    .update(stringToSign)
    .digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const url = `${endpoint.origin}${canonicalUri}?${qs}`;
  const res = await fetch(url, {
    headers: {
      Authorization: authorization,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
    },
  });
  const xml = await res.text();
  if (!res.ok) throw new Error(`R2 list ${res.status}: ${xml.slice(0, 300)}`);
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
  const mods = [...xml.matchAll(/<LastModified>([^<]+)<\/LastModified>/g)].map(
    (m) => m[1]
  );
  const truncated = /IsTruncated>true</.test(xml);
  const next = (xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/) ||
    [])[1];
  return { keys, mods, truncated, next };
}

async function listAll(prefix) {
  const out = [];
  let token;
  for (let i = 0; i < 50; i++) {
    const page = await listPrefix(prefix, token);
    for (let j = 0; j < page.keys.length; j++) {
      out.push({ key: page.keys[j], modified: page.mods[j] || "" });
    }
    if (!page.truncated || !page.next) break;
    token = page.next;
  }
  return out;
}

const dayArg = process.argv[2] || new Date().toISOString().slice(0, 10);
const dayCompact = dayArg.replace(/-/g, "");
const prefixes = ["videos/", "frases/", "ndigital/", "local/", "trad/", "dub/"];

const seen = new Set();
const todays = [];
for (const prefix of prefixes) {
  let items = [];
  try {
    items = await listAll(prefix);
  } catch (err) {
    console.warn("skip list", prefix, err.message);
    continue;
  }
  for (const it of items) {
    if (!/\.mp4$/i.test(it.key)) continue;
    if (seen.has(it.key)) continue;
    const byMod = String(it.modified).startsWith(dayArg);
    const byKey = it.key.includes(dayCompact);
    if (!byMod && !byKey) continue;
    seen.add(it.key);
    todays.push(it);
  }
}

todays.sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
console.log(`Día ${dayArg}: ${todays.length} video(s) en R2`);
for (const it of todays) console.log(" ", it.modified, it.key);

if (!todays.length) {
  process.exit(0);
}

const existing = existsSync(VIDEO_ARCHIVE_DIR)
  ? new Set(await readdir(VIDEO_ARCHIVE_DIR))
  : new Set();

let ok = 0;
let fail = 0;
for (const it of todays) {
  const url = publicR2Url(it.key);
  const hint =
    (it.key.match(/(\d{8}-\d{6})/) || [])[1] ||
    dayCompact + "-" + basename(it.key).replace(/\.mp4$/i, "").slice(0, 40);
  const already = [...existing].some(
    (f) => f.endsWith(".mp4") && (f.includes(hint) || f.includes(basename(it.key).slice(0, 30)))
  );
  if (already) {
    console.log("skip (ya en video2):", it.key);
    rememberArchivedUrl(url);
    continue;
  }
  console.log("bajando", it.key);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const caption = basename(it.key);
    const saved = await archiveProducedVideo({
      buffer: buf,
      caption,
      nameHint: hint,
    });
    rememberArchivedUrl(url);
    existing.add(basename(saved.videoPath));
    console.log("ok", saved.videoPath, buf.length);
    ok += 1;
  } catch (err) {
    console.warn("fail", it.key, err.message);
    fail += 1;
  }
}

console.log(`Listo: ${ok} guardados en ${VIDEO_ARCHIVE_DIR}, ${fail} fallos`);
