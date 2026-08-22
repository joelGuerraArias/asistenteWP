import { runFraseCelebre } from "../src/frase-celebre.mjs";

const args = process.argv.slice(2);
const test = args.includes("--test");
const publish = args.includes("--publish");

try {
  const result = await runFraseCelebre({
    test,
    publish: publish ? true : test ? false : undefined,
    onProgress: (line) => {
      if (/Capturing frame|Render complete|Encoding|error|Error/i.test(line)) {
        console.log(line);
      }
    },
  });
  if (result?.skipped) process.exit(0);
  console.log(
    result?.published
      ? `OK publicado: ${result.videoUrl}`
      : `OK local: ${result.outputPath}`
  );
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
