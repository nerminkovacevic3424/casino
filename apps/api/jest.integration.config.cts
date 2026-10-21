/**
 * Integration tests: the real AppModule against Postgres and Redis in Docker
 * (Testcontainers). Requires a running Docker engine.
 *   pnpm nx run api:integration
 */
module.exports = {
  displayName: 'api-integration',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['<rootDir>/test/**/*.int-spec.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  globalTeardown: '<rootDir>/test/global-teardown.ts',
  testTimeout: 60_000,
  maxWorkers: 1,
  coverageDirectory: '../../coverage/apps/api-integration',
};
