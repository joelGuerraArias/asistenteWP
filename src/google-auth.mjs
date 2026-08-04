import { google } from "googleapis";
import { config } from "./config.mjs";

/**
 * OAuth2 con refresh token (cuenta autosemana / la autorizada).
 */
export function getGoogleOAuth2Client() {
  const { clientId, clientSecret, refreshToken } = config.googleAlerts?.oauth || {};
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN en .env"
    );
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

export function getGmailApi() {
  return google.gmail({ version: "v1", auth: getGoogleOAuth2Client() });
}

export function getSheetsApi() {
  return google.sheets({ version: "v4", auth: getGoogleOAuth2Client() });
}

export function getDriveApi() {
  return google.drive({ version: "v3", auth: getGoogleOAuth2Client() });
}

/**
 * Busca o crea un Google Sheet en la carpeta de Drive configurada.
 */
export async function resolveAlertsSpreadsheetId() {
  if (config.googleAlerts.sheetId) {
    return config.googleAlerts.sheetId;
  }

  const folderId = config.googleAlerts.driveFolderId;
  if (!folderId) {
    throw new Error(
      "Falta GOOGLE_ALERTS_SHEET_ID o GOOGLE_DRIVE_FOLDER_ID en .env"
    );
  }

  const drive = getDriveApi();
  const nameHint = config.googleAlerts.sheetFileName || "Alertas Intrant";

  const listed = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 20,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files = listed.data.files || [];
  const preferred =
    files.find((f) => /alerta|intrant/i.test(f.name || "")) || files[0];

  if (preferred?.id) {
    console.log(`📄 Sheet encontrado en Drive: ${preferred.name} (${preferred.id})`);
    return preferred.id;
  }

  // Crear uno nuevo en la carpeta
  const created = await drive.files.create({
    requestBody: {
      name: nameHint,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [folderId],
    },
    fields: "id, name",
    supportsAllDrives: true,
  });

  console.log(`📄 Sheet creado: ${created.data.name} (${created.data.id})`);
  return created.data.id;
}
