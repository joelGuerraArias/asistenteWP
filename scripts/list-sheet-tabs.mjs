import { config } from "../src/config.mjs";
import { getSheetsApi } from "../src/google-auth.mjs";

const id = config.electricAlerts.sheetId;
const sheets = getSheetsApi();
const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
for (const s of meta.data.sheets || []) {
  const title = s.properties.title;
  const range = `'${title.replace(/'/g, "''")}'!A:A`;
  const filled =
    (await sheets.spreadsheets.values.get({ spreadsheetId: id, range })).data
      .values?.length || 0;
  console.log(`${title}: ${filled} filas`);
}
