/** Three projects mirror the test folders: unit (fast, no I/O), integration (real services), security (authz/tenancy suites). */
const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
};

/** Starting the app and a database is slow when the compile cache is cold; see test/support/long-timeout.ts. */
const slowSetup = { setupFilesAfterEnv: ['<rootDir>/test/support/long-timeout.ts'] };

module.exports = {
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] },
    {
      ...base,
      ...slowSetup,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
    },
    {
      ...base,
      ...slowSetup,
      displayName: 'security',
      testMatch: ['<rootDir>/test/security/**/*.spec.ts'],
    },
  ],
  passWithNoTests: true,
};
