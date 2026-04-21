import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				test: {
					name: 'unit',
					environment: 'node',
					include: ['test/unit/**/*.spec.ts']
				}
			},
			{
				test: {
					name: 'e2e',
					environment: 'node',
					include: ['test/e2e/**/*.e2e.spec.ts'],
					testTimeout: 30000,
					hookTimeout: 30000
				}
			}
		]
	}
});
