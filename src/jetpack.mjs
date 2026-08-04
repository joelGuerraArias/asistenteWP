import { config, wpAuthHeader } from "./config.mjs";

function jetpackUrl(path) {
  return `${config.wp.siteUrl}/wp-json/jetpack/v4${path}`;
}

async function jetpackRequest(path, { method = "GET", body } = {}) {
  const headers = {
    ...wpAuthHeader(),
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json; charset=utf-8";
  }

  const res = await fetch(jetpackUrl(path), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg =
      typeof data === "object" && data?.message
        ? data.message.replace(/<[^>]+>/g, "")
        : text;
    throw new Error(`Jetpack ${res.status}: ${msg}`);
  }

  return data;
}

export async function getJetpackSettings() {
  return jetpackRequest("/settings");
}

export async function disablePhoton() {
  const attempts = [
    { photon: false },
    { "photon-cdn": false },
    { jetpack_photon: false },
    { site_accelerator_photon: false },
  ];

  const results = [];

  for (const payload of attempts) {
    try {
      const data = await jetpackRequest("/settings", { method: "POST", body: payload });
      results.push({ payload, ok: true, data });
    } catch (error) {
      results.push({ payload, ok: false, error: error.message });
    }
  }

  try {
    await jetpackRequest("/module/photon/active", {
      method: "POST",
      body: { active: false },
    });
    results.push({ module: "photon", ok: true });
  } catch (error) {
    results.push({ module: "photon", ok: false, error: error.message });
  }

  return results;
}

function wpPluginsUrl(path) {
  return `${config.wp.siteUrl}/wp-json/wp/v2${path}`;
}

export async function listPlugins() {
  const res = await fetch(wpPluginsUrl("/plugins"), {
    headers: wpAuthHeader(),
    signal: AbortSignal.timeout(60000),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : [];
  if (!res.ok) {
    throw new Error(`WordPress ${res.status}: ${data?.message || text}`);
  }
  return data;
}

export async function activatePlugin(pluginFile = "fv-sin-photon/fv-sin-photon") {
  const res = await fetch(wpPluginsUrl(`/plugins/${encodeURIComponent(pluginFile)}`), {
    method: "POST",
    headers: {
      ...wpAuthHeader(),
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ status: "active" }),
    signal: AbortSignal.timeout(60000),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`WordPress ${res.status}: ${data?.message || text}`);
  }
  return data;
}

export async function ensureFvSinPhotonPlugin() {
  const plugins = await listPlugins();
  const plugin = plugins.find(
    (item) =>
      item.plugin === "fv-sin-photon/fv-sin-photon.php" ||
      item.textdomain === "fv-sin-photon" ||
      item.name?.includes("FV Sin Photon")
  );

  if (!plugin) {
    return { installed: false, active: false };
  }

  if (plugin.status === "active") {
    return { installed: true, active: true, plugin };
  }

  const activated = await activatePlugin(plugin.plugin);
  return { installed: true, active: true, plugin: activated };
}
