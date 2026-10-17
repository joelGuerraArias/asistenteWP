import { createHash, createHmac } from "node:crypto";
import { config } from "../src/config.mjs";

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

const cfg = config.r2;
const endpoint = new URL(cfg.endpoint);
const host = endpoint.host;
const prefix = process.argv[2] || "cards/fv-card-";
const qs = `list-type=2&max-keys=30&prefix=${encodeURIComponent(prefix)}`;
const canonicalUri = `/${cfg.bucket}`;
const iso = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
const amzDate = `${iso.slice(0, 15)}Z`;
const dateStamp = amzDate.slice(0, 8);
const payloadHash = sha256Hex("");
const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
const canonicalRequest = ["GET", canonicalUri, qs, canonicalHeaders, signedHeaders, payloadHash].join("\n");
const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
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
if (!res.ok) {
  console.log("status", res.status, xml.slice(0, 500));
  process.exit(1);
}
const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
const mods = [...xml.matchAll(/<LastModified>([^<]+)<\/LastModified>/g)].map((m) => m[1]);
const rows = keys
  .map((k, i) => ({ k, t: mods[i] }))
  .sort((a, b) => String(b.t).localeCompare(String(a.t)));
for (const r of rows.slice(0, 15)) console.log(r.t, r.k);
