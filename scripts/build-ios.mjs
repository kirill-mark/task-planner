import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = path.join(root, "dist");
await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

// Keep the existing PWA's CDN import; replace it only in the bundled iOS build.
const result = await build({
  absWorkingDir: root,
  entryPoints: ["js/native.js", "js/recovery-page.js"],
  outdir: "dist/assets",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: ["safari15"],
  entryNames: "[name]-[hash]",
  chunkNames: "chunk-[hash]",
  minify: true,
  metafile: true,
  plugins: [{
    name: "bundle-supabase-sdk",
    setup(b) {
      b.onResolve({ filter: /^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\/\+esm$/ }, () =>
        b.resolve("@supabase/supabase-js", { resolveDir: root, kind: "import-statement" }));
    },
  }],
});

for (const dir of ["css", "icons"]) await fs.cp(path.join(root, dir), path.join(dist, dir), { recursive: true });

const entry = Object.entries(result.metafile.outputs).find(([, output]) => output.entryPoint === "js/native.js")?.[0];
if (!entry) throw new Error("Native entry point missing from build");
const script = entry.replace(/^dist\//, "");
let html = await fs.readFile(path.join(root, "index.html"), "utf8");
html = html
  .replace(/\s*<link rel="manifest"[^>]*>/, "")
  .replace(/\s*<script src="https:\/\/telegram\.org\/js\/telegram-web-app\.js"><\/script>/, "")
  .replace(/<script type="module" src="js\/boot\.js\?v=1"><\/script>/, `<script type="module" src="${script}"></script>`)
  .replace(/\s*<script>\s*if \("serviceWorker" in navigator\) \{[\s\S]*?<\/script>/, "");

// Native resources must be local, including dependencies loaded at startup.
if (/<script[^>]+src="https?:/i.test(html)) throw new Error("Remote startup script in native HTML");
await fs.writeFile(path.join(dist, "index.html"), html);
const recoveryEntry = Object.entries(result.metafile.outputs).find(([, output]) => output.entryPoint === "js/recovery-page.js")?.[0];
if (!recoveryEntry) throw new Error("Recovery entry point missing from build");
const recoveryHTML = (await fs.readFile(path.join(root, "recover.html"), "utf8"))
  .replace('src="js/recovery-page.js"', `src="${recoveryEntry.replace(/^dist\//, "")}"`);
await fs.writeFile(path.join(dist, "recover.html"), recoveryHTML);
await fs.mkdir(path.join(root, "work"), { recursive: true });
await fs.writeFile(path.join(root, "work/build-metafile.json"), JSON.stringify(result.metafile, null, 2));
console.log(`MARK iOS assets built: ${Object.keys(result.metafile.outputs).length} bundled files`);
