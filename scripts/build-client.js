import esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'fs';

const minify = process.argv.includes('--minify');

await esbuild.build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  format: 'iife',
  minify,
  outfile: 'public/script.js',
});

if (minify) {
  // Copy static assets to dist/public, then minify CSS there
  mkdirSync('dist/public', { recursive: true });
  cpSync('public', 'dist/public', { recursive: true });

  await esbuild.build({
    entryPoints: ['dist/public/style.css'],
    minify: true,
    outfile: 'dist/public/style.css',
    allowOverwrite: true,
  });
}
