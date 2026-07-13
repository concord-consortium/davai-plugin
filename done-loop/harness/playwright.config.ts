import { PlaywrightCoverageOptions } from "@bgotink/playwright-coverage";
import { defineConfig, devices, ReporterDescription } from "@playwright/test";
import path from "path";

const collectCoverage = !!process.env.CI;
const coverageReporter: ReporterDescription = [
  "@bgotink/playwright-coverage",
  /** @type {import('@bgotink/playwright-coverage').CoverageReporterOptions} */ {
    /* Path to the root files should be resolved from */
    sourceRoot: __dirname,
    /* The coverage is reported with a prefix. This is probably because we are
       running in an iframe so the coverage of CODAP and the plugin is differentiated
       by the two prefixes. */
    exclude: [
      /* Ignore all coverage of the CODAP application itself. */
      "codap3/src/**", "codap3/webpack/**"
    ],
    /* Modify the paths of files on which coverage is reported. This is run after
       the exclude filter, so it does not get any of the codap3 files.
       The paths returned by the v8 coverage have two issues which at least make them
       break the html report. They have an extra prefix of the project name so they
       look like `codap-plugin-starter-project/codap-plugin-starter-project/src`. They
       have a suffix like `?[random string]` like `App.tsx?c341`. */
    rewritePath: ({absolutePath}) => {
      // It isn't clear if this is before or after the exclude rule
      return (absolutePath as string)
        .replace("codap-plugin-starter-project/", "")
        .replace(/\?[0-9a-z]+$/,"");
    },
    /* Directory in which to write coverage reports */
    resultDir: path.join(__dirname, "test-results", "coverage"),
    /* Configure the reports to generate.
       The value is an array of istanbul reports, with optional configuration attached. */
    reports: [
      /* Create an HTML view at <resultDir>/index.html */
      ["html"],
      /* Create <resultDir>/coverage.lcov for consumption by codecov */
      [
        "lcovonly",
        {
          file: "coverage.lcov",
        },
      ],
      /* Log a coverage summary at the end of the test run */
      [
        "text-summary",
        {
          file: null,
        },
      ],
    ],
    /* Configure watermarks, see https://github.com/istanbuljs/nyc#high-and-low-watermarks */
    // watermarks: {},
  },
];

/* We report json in CI so the `daun/playwright-report-summary` action can add a summary of
   the results to a PR comment. */
const reportJson = !!process.env.CI;
const jsonReporter: ReporterDescription = ["json", { outputFile: path.join("test-results", "results.json") }];

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig<PlaywrightCoverageOptions>({
  testDir: "./playwright",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    [ "html" ],
    [ "list" ],
    ...(collectCoverage ? [coverageReporter] : []),
    ...(reportJson ? [jsonReporter] : []),
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    // baseURL: 'http://127.0.0.1:3000',

    /* Collect trace. See https://playwright.dev/docs/trace-viewer
       The default value of this is "on-first-retry". This is recommended because recording traces
       slows down the test. However it is nice to have record of the trace for example when reviewing
       a PR and you want to see what things look like. We should revisit this in the future. */
    trace: process.env.CI ? "on" : "off",

    /* Ignore https errors so we don't have to have valid certificates especially on CI */
    ignoreHTTPSErrors: true,

    /* Only collect coverage information if we are running in CI */
    collectCoverage,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium with channel",
      use: { ...devices["Desktop Chrome"], channel: "chromium" },
    },

    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run local dev server before starting the tests */
  webServer: {
    command: "npm run start:secure",
    url: "https://localhost:8080/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    ignoreHTTPSErrors: true,
  },
});
