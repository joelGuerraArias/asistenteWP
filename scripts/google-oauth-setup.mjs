/**
 * Reautoriza Google OAuth con scopes de Gmail + Sheets + Drive.
 * Abre el navegador, pegas el code y guarda el refresh token.
 *
 *   node scripts/google-oauth-setup.mjs
 */
import http from "node:http";
import { google } from "googleapis";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/oauth2callback`;

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
];

const { clientId, clientSecret } = config.googleAlerts.oauth;
if (!clientId || !clientSecret) {
  console.error("Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);
const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

console.log("\n1) Abre esta URL en el navegador (cuenta autosemana@gmail.com):\n");
console.log(authUrl);
console.log("\n2) Autoriza. Se capturará el código automáticamente...\n");

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url?.startsWith("/oauth2callback")) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400);
      res.end("Falta code");
      return;
    }

    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>OK</h1><p>Ya puedes cerrar esta ventana y volver a Cursor.</p>");

    if (!tokens.refresh_token) {
      console.error("No vino refresh_token. Revoca el acceso en https://myaccount.google.com/permissions y reintenta.");
      server.close();
      process.exit(1);
    }

    console.log("\n✅ Nuevo GOOGLE_REFRESH_TOKEN:");
    console.log(tokens.refresh_token);

    const envPath = join(root, ".env");
    let env = readFileSync(envPath, "utf8");
    if (/^GOOGLE_REFRESH_TOKEN=.*/m.test(env)) {
      env = env.replace(/^GOOGLE_REFRESH_TOKEN=.*/m, `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    } else {
      env += `\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
    }
    writeFileSync(envPath, env);
    console.log("\nGuardado en .env");
    server.close();
    process.exit(0);
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end(String(error.message));
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, "127.0.0.1");
