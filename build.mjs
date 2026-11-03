import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "dist");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const file of ["index.html", "styles.css", "app.js", "manifest.webmanifest", "icon.svg", "service-worker.js"]) {
  cpSync(resolve(root, file), resolve(output, file));
}
console.log(`Prepared static site in ${output}`);
