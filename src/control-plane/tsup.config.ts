import { defineConfig } from 'tsup';

// Bundles the app; dependencies stay runtime dependencies (node_modules).
export default defineConfig({
  entry: {
    main: 'src/main.ts', 'db/migrate': 'src/db/migrate.ts',
    'storage/bootstrap-cli': 'src/storage/bootstrap-cli.ts',
  },
  format: 'esm',
  target: 'node24',
  clean: true,
});
