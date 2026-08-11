import nodeAdapter from '@sveltejs/adapter-node';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const serverBuild = process.env.BUILD_TARGET === 'server';

export default defineConfig({
	plugins: [
		sveltekit({
			files: {
				assets: 'public'
			},
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in Svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			adapter: serverBuild
				? nodeAdapter()
				: adapter({
						fallback: undefined,
						// API routes are emitted by `pnpm build:server`, while the
						// existing GitHub Pages build remains static.
						strict: false
					})
		})
	],
	server: {
		host: '127.0.0.1',
		port: 3000,
		strictPort: true
	}
});
