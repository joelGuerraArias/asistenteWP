import {
  getDriveApi,
  getGmailApi,
  resolveAlertsSpreadsheetId,
} from "../src/google-auth.mjs";

try {
  const drive = getDriveApi();
  const folder = await drive.files.get({
    fileId: "10wJNNTmE9aO1cI98N7oKGmE-vJAUFrjg",
    fields: "id,name",
  });
  console.log("Drive folder OK:", folder.data.name);

  const list = await drive.files.list({
    q: "'10wJNNTmE9aO1cI98N7oKGmE-vJAUFrjg' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: "files(id,name)",
    pageSize: 20,
  });
  console.log("Sheets in folder:", list.data.files);

  const id = await resolveAlertsSpreadsheetId();
  console.log("Resolved sheet id:", id);

  try {
    const gmail = getGmailApi();
    const profile = await gmail.users.getProfile({ userId: "me" });
    console.log("Gmail OK:", profile.data.emailAddress);
  } catch (ge) {
    console.error("Gmail scope ERROR:", ge.message);
    if (ge.response?.data) console.error(JSON.stringify(ge.response.data, null, 2));
  }
} catch (e) {
  console.error("ERROR:", e.message);
  if (e.response?.data) console.error(JSON.stringify(e.response.data, null, 2));
  process.exit(1);
}
