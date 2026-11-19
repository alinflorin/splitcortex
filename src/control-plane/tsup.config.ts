import { defineConfig } from 'tsup';

// Bundles the app; dependencies stay runtime dependencies (node_modules).
export default defineConfig({
  entry: {
    main: 'src/main.ts', 'db/migrate': 'src/db/migrate.ts',
    'storage/bootstrap-cli': 'src/storage/bootstrap-cli.ts',
    'storage/sweep-cli': 'src/storage/sweep-cli.ts',
    'db/audit-prune-cli': 'src/db/audit-prune-cli.ts',
    'db/metrics-prune-cli': 'src/db/metrics-prune-cli.ts',
  },
  format: 'esm',
  target: 'node24',
  clean: true,
});
