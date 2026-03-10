import esbuild from 'esbuild';

const minify = process.argv.includes('--minify');

await esbuild.build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  format: 'iife',
  minify,
  outfile: 'public/script.js',
});

if (minify) {
  await esbuild.build({
    entryPoints: ['public/style.css'],
    minify: true,
    outfile: 'public/style.css',
    allowOverwrite: true,
  });
}
