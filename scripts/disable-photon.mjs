import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.mjs";
import {
  activatePlugin,
  disablePhoton,
  ensureFvSinPhotonPlugin,
  getJetpackSettings,
} from "../src/jetpack.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = join(root, "wordpress-plugin", "fv-sin-photon");
const pluginFile = join(pluginDir, "fv-sin-photon.php");
const distDir = join(root, "dist");
const zipPath = join(distDir, "fv-sin-photon.zip");
const muPluginPath = join(distDir, "fv-sin-photon.php");

function log(step, message) {
  console.log(`[${step}] ${message}`);
}

function createZip() {
  mkdirSync(distDir, { recursive: true });
  writeFileSync(muPluginPath, readFileSync(pluginFile));

  if (process.platform === "win32") {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${pluginDir}\\*' -DestinationPath '${zipPath}' -Force`,
      ],
      { stdio: "inherit" }
    );
  } else {
    execFileSync("zip", ["-r", zipPath, "."], { cwd: pluginDir, stdio: "inherit" });
  }

  return { zipPath, muPluginPath };
}

function uploadViaFtp(localPath, remoteName) {
  const host = process.env.WORDPRESS_FTP_HOST;
  const user = process.env.WORDPRESS_FTP_USER;
  const pass = process.env.WORDPRESS_FTP_PASSWORD;
  const remoteBase =
    process.env.WORDPRESS_FTP_MU_PLUGINS_PATH ||
    process.env.WORDPRESS_FTP_REMOTE_PATH ||
    "/httpdocs/wp-content/mu-plugins";

  if (!host || !user || !pass) {
    return false;
  }

  const remotePath = `${remoteBase.replace(/\/$/, "")}/${remoteName}`;
  const url = `ftp://${host}${remotePath}`;

  execFileSync(
    "curl.exe",
    [
      "--ftp-create-dirs",
      "-T",
      localPath,
      "--user",
      `${user}:${pass}`,
      url,
    ],
    { stdio: "inherit" }
  );

  return true;
}

async function main() {
  log("1/4", "Desactivando Photon en Jetpack (API)...");
  try {
    const before = await getJetpackSettings();
    log("jetpack", `photon=${before?.photon}, photon-cdn=${before?.["photon-cdn"]}`);
  } catch (error) {
    log("jetpack", `No pude leer settings: ${error.message}`);
  }

  const jetpackResults = await disablePhoton();
  for (const item of jetpackResults) {
    if (item.ok) {
      log("jetpack", `OK ${JSON.stringify(item.payload || item.module)}`);
    } else {
      log("jetpack", `Falló ${JSON.stringify(item.payload || item.module)}: ${item.error}`);
    }
  }

  log("2/4", "Preparando plugin FV Sin Photon...");
  const artifacts = createZip();
  log("build", `ZIP: ${artifacts.zipPath}`);
  log("build", `MU-plugin: ${artifacts.muPluginPath}`);

  log("3/4", "Desplegando plugin al servidor...");
  let deployed = false;

  if (uploadViaFtp(artifacts.muPluginPath, "fv-sin-photon.php")) {
    log("ftp", "Subido a mu-plugins vía FTP");
    deployed = true;
  } else if (
    process.env.WORDPRESS_FTP_HOST ||
    process.env.WORDPRESS_FTP_USER ||
    process.env.WORDPRESS_FTP_PASSWORD
  ) {
    log("ftp", "FTP configurado pero falló la subida");
  } else {
    log("ftp", "Sin credenciales FTP — salto subida automática");
  }

  log("4/4", "Activando plugin vía REST (si ya está en wp-content/plugins)...");
  try {
    const pluginState = await ensureFvSinPhotonPlugin();
    if (pluginState.installed) {
      log("plugin", pluginState.active ? "FV Sin Photon activo" : "Instalado pero no activo");
      deployed = true;
    } else {
      log("plugin", "No instalado en wp-content/plugins todavía");
    }
  } catch (error) {
    log("plugin", error.message);
    try {
      await activatePlugin();
      log("plugin", "FV Sin Photon activado");
      deployed = true;
    } catch (activateError) {
      log("plugin", activateError.message);
    }
  }

  console.log("");
  if (deployed) {
    console.log("Photon desactivado. Las imágenes deben servirse desde fvdigital.do.");
  } else {
    console.log("Jetpack API actualizado. Falta instalar el plugin en el servidor:");
    console.log("");
    console.log("Opción A — mu-plugin (recomendado, sin activar):");
    console.log(`  Subir ${artifacts.muPluginPath}`);
    console.log("  a wp-content/mu-plugins/fv-sin-photon.php");
    console.log("");
    console.log("Opción B — plugin normal:");
    console.log(`  Subir ${artifacts.zipPath} en WP Admin → Plugins → Añadir nuevo → Subir`);
    console.log("");
    console.log("Opción C — FTP automático: añade a .env");
    console.log("  WORDPRESS_FTP_HOST=...");
    console.log("  WORDPRESS_FTP_USER=...");
    console.log("  WORDPRESS_FTP_PASSWORD=...");
    console.log("  WORDPRESS_FTP_MU_PLUGINS_PATH=/httpdocs/wp-content/mu-plugins");
    console.log("  y vuelve a ejecutar: npm run disable-photon");
  }

  console.log("");
  console.log(`Sitio: ${config.wp.siteUrl}`);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
