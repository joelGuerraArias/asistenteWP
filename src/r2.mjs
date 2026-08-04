import { createHash, createHmac } from "node:crypto";
import { config } from "./config.mjs";

const REGION = "auto";
const SERVICE = "s3";

function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

function amzDates(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const amzDate = iso.slice(0, 15) + "Z"; // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8); // YYYYMMDD
  return { amzDate, dateStamp };
}

function signingKey(secret, dateStamp) {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

// Cada segmento de la key se codifica pero se conservan las "/".
function encodeKey(key) {
  return key
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/**
 * Sube un buffer a Cloudflare R2 (S3-compatible) usando SigV4, sin dependencias.
 * @returns {Promise<string>} URL pública del objeto.
 */
export async function uploadToR2(buffer, key, contentType = "application/octet-stream") {
  const cfg = config.r2;
  if (!cfg.enabled) {
    throw new Error(
      "R2 no está configurado (faltan endpoint, bucket, credenciales o URL pública)."
    );
  }

  const endpoint = new URL(cfg.endpoint);
  const host = endpoint.host;
  const canonicalUri = `/${cfg.bucket}/${encodeKey(key)}`;
  const url = `${endpoint.origin}${canonicalUri}`;

  const { amzDate, dateStamp } = amzDates();
  const payloadHash = sha256Hex(buffer);

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
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

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      "Content-Type": contentType,
      "Content-Length": String(buffer.length),
    },
    body: buffer,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`R2 PUT ${res.status}: ${detail.slice(0, 200)}`);
  }

  // Siempre URL pública del bucket (r2.dev / dominio custom), NUNCA el endpoint S3 API.
  return publicR2Url(key);
}

/** URL pública del objeto en R2 (R2_PUBLIC_BASE_URL). */
export function publicR2Url(key) {
  const cfg = config.r2;
  if (!cfg.publicBaseUrl) {
    throw new Error("Falta R2_PUBLIC_BASE_URL (URL pública del bucket, no el endpoint API).");
  }
  if (/cloudflarestorage\.com/i.test(cfg.publicBaseUrl)) {
    throw new Error(
      "R2_PUBLIC_BASE_URL no puede ser *.r2.cloudflarestorage.com (eso es el API). Usa pub-….r2.dev o tu dominio."
    );
  }
  const path = encodeKey(String(key || "").replace(/^\/+/, ""));
  return `${cfg.publicBaseUrl}/${path}`;
}

/** True si la URL es la pública de R2 configurada (no API S3). */
export function isPublicR2Url(url = "") {
  const base = (config.r2?.publicBaseUrl || "").replace(/\/$/, "");
  if (!base || !url) return false;
  if (/cloudflarestorage\.com/i.test(url)) return false;
  return String(url).startsWith(base);
}
