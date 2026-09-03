import { searchHeadlineSources } from "../src/headline-search.mjs";

const headline =
  process.argv.slice(2).join(" ").trim() ||
  "Méndez dispone recuperar técnicos especializados para fortalecer el INTRANT";

console.log("Starting search…");
const r = await searchHeadlineSources(headline, {
  send: true,
  onStatus: (m) => console.log(m),
});

console.log("---COMPARE---");
console.log(JSON.stringify(r.compare, null, 2));
console.log("---BEST---");
console.log(
  r.best
    ? {
        medio: r.best.medio,
        title: r.best.title,
        url: r.best.url,
        engines: r.best.engines,
        score: r.best._score,
      }
    : null
);
console.log("---SENT---");
console.log(JSON.stringify(r.sent, null, 2));
console.log("---SUBJECT---");
console.log(r.email.subject);
console.log("---HITS---");
for (const h of r.hits.slice(0, 8)) {
  console.log(
    `[${h.engines.join("+")}] score=${h._score} ${h.medio}: ${h.title}\n  ${h.url}`
  );
}
