/**
 * Auditoría del filtrado Intrant vs Edesur para el MD de hoy.
 */
import {
  loadAnalisisHoy,
  filterForClient,
  CLIENTS,
} from "../src/informe-parse.mjs";

function auditChannel(channel) {
  console.log(`\n========== ${channel.toUpperCase()} ==========`);
  let analisis;
  try {
    analisis = loadAnalisisHoy(new Date(), channel);
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    return;
  }
  console.log(`Archivo: ${analisis.path}`);
  console.log(`Items parseados: ${analisis.items.length}`);

  const allTerms = [...new Set(analisis.items.map((i) => i.term))];
  console.log(`Términos únicos: ${allTerms.join(" | ") || "(ninguno)"}`);

  for (const clientId of ["intrant", "edesur"]) {
    const { client, items } = filterForClient(analisis, clientId, channel);
    console.log(`\n--- ${client.label} (${items.length}) ---`);
    if (!items.length) {
      console.log("(vacío)");
      continue;
    }
    items.forEach((it, idx) => {
      const why = client.keywords.filter((kw) =>
        `${it.term} ${it.tema} ${it.contexto} ${it.puntos}`
          .toLowerCase()
          .includes(kw.toLowerCase())
      );
      console.log(
        `${idx + 1}. term="${it.term}" | matchKeywords=[${why.join(", ")}]`
      );
      console.log(`   tema: ${(it.tema || "").slice(0, 100)}`);
    });
  }

  // Cruce: items que entran en AMBOS
  const a = filterForClient(analisis, "intrant", channel).items;
  const b = filterForClient(analisis, "edesur", channel).items;
  const cross = [];
  for (const ia of a) {
    for (const ib of b) {
      if (
        ia.term === ib.term &&
        (ia.tema || "") === (ib.tema || "") &&
        (ia.videoUrl || "") === (ib.videoUrl || "")
      ) {
        cross.push(ia);
      }
    }
  }
  if (cross.length) {
    console.log(`\n⚠️  CRUCE (mismo ítem en Intrant Y Edesur): ${cross.length}`);
    cross.forEach((it) => console.log(`   - ${it.term}: ${(it.tema || "").slice(0, 80)}`));
  } else {
    console.log(`\nCruce exacto Intrant∩Edesur: 0`);
  }

  // Items Intrant cuyo term es claramente eléctrico (y viceversa)
  const edesurKw = CLIENTS.edesur.keywords;
  const intrantKw = CLIENTS.intrant.keywords;
  const leakToIntrant = a.filter((it) => {
    const t = (it.term || "").toLowerCase();
    return edesurKw.some((k) => t.includes(k.toLowerCase())) &&
      !intrantKw.some((k) => t.includes(k.toLowerCase()));
  });
  const leakToEdesur = b.filter((it) => {
    const t = (it.term || "").toLowerCase();
    return intrantKw.some((k) => t.includes(k.toLowerCase())) &&
      !edesurKw.some((k) => t.includes(k.toLowerCase()));
  });
  if (leakToIntrant.length) {
    console.log(`\n⚠️  En INTRANT con término eléctrico: ${leakToIntrant.map((i) => i.term).join(", ")}`);
  }
  if (leakToEdesur.length) {
    console.log(`\n⚠️  En EDESUR con término Intrant: ${leakToEdesur.map((i) => i.term).join(", ")}`);
  }
}

auditChannel("tv");
auditChannel("radio");
