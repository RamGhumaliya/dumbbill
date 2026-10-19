/**
 * Gives every test and setup hook in the integration and security projects 60 seconds.
 *
 * Why a setup file and not `testTimeout` in jest.config.js: Jest ignores `testTimeout` when it is written inside a
 * project, so hooks silently kept the 5-second default. Starting the whole app and a fresh database takes longer than
 * that whenever the compile cache is cold (the first run after any source change), which showed up as random
 * "Exceeded timeout of 5000 ms for a hook" failures.
 */
jest.setTimeout(60_000);
