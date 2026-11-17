import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

/**
 * Testes de interface React (DEV-01.1): arquivos `*.test.tsx`, em jsdom.
 * Os testes de lógica (`*.test.ts`) continuam no executor nativo do Node.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.tsx'],
      restoreMocks: true,
    },
  }),
)
