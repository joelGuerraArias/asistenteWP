import fs from "node:fs";
import path from "node:path";
import generateAliasesResolver from "./node_modules/esm-module-alias/index.js";

const packageJson = JSON.parse(fs.readFileSync("./package.json", "utf8"));
const aliases = packageJson.aliases || {};

// Para alias exactos (como "lodash"), no usamos path.join con subpath.
const absoluteAliases = Object.keys(aliases).reduce((acc, key) => {
  const val = aliases[key];
  if (val[0] === "/") return { ...acc, [key]: val };
  const resolved = path.resolve(val);
  return { ...acc, [key]: process.platform === "win32" ? "file:///" + resolved.replace(/\\/g, "/") : resolved };
}, aliases);

export const resolve = (specifier, parentModuleURL, defaultResolve) => {
  if (absoluteAliases[specifier]) {
    return defaultResolve(absoluteAliases[specifier], parentModuleURL);
  }
  return defaultResolve(specifier, parentModuleURL);
};
