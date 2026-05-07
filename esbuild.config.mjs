import { build } from "esbuild";

const buildOptions = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  minify: true,
  treeShaking: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  external: ["vscode"],
  sourcemap: false,
  legalComments: "none",
  loader: { ".html": "text", ".txt": "text" },
  logLevel: "info",
};

await build(buildOptions);
