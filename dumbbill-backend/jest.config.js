/** Three projects mirror the test folders: unit (fast, no I/O), integration (real services), security (authz/tenancy suites). */
const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
};

module.exports = {
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] },
    {
      ...base,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
      testTimeout: 60000,
    },
    {
      ...base,
      displayName: 'security',
      testMatch: ['<rootDir>/test/security/**/*.spec.ts'],
      testTimeout: 60000,
    },
  ],
  passWithNoTests: true,
};
