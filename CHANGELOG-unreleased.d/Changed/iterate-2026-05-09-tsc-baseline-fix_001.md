Server `tsconfig.json` + `vitest.config.ts` — dropped unused `@shared/*` path alias pointing into `client/src/types` (latent footgun; nothing in `server/src/**` consumed it).
