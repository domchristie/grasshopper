import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // firefox: no Navigation API in current Playwright build
    // webkit: grasshopper has a bug passing Document through navigation.navigate() info
  ],
  webServer: {
    command: 'node test/server.js',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
})
