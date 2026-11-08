import {build} from 'esbuild';
await build({
  entryPoints:{server:'src/server.ts',migrate:'src/migrate.ts'},
  outdir:'dist',bundle:true,platform:'node',format:'esm',target:'node22',sourcemap:true,
  external:['fastify','pg','jose','zod','google-auth-library','@fastify/rate-limit','luxon'],
});
