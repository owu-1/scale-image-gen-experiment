import path from 'node:path'
import {
  defineWorkersConfig,
  readD1Migrations
} from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(__dirname, "migrations");
	const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: {
						// Add a test-only binding for migrations, so we can apply them in a
						// setup file
						bindings: { TEST_MIGRATIONS: migrations },
					},
        }
      }
    }
  }
})
