import { defineConfig } from 'vitest/config'

// `spec/` is the carve repo as a submodule; its own suite must not run here.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } })
