import { build } from 'esbuild';
await build({ entryPoints: ['src/app.js'], bundle: true, outfile: 'app/bundle.js', format: 'iife', target: 'chrome120', minify: true, sourcemap: false, logLevel: 'info' });
