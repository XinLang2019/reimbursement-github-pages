import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// configure-pages supplies the real path, including custom-domain deployments.
const repository = process.env.GITHUB_REPOSITORY?.split('/')[1];
const configuredBase = process.env.PAGES_BASE_PATH;
const path = configuredBase !== undefined
  ? configuredBase
  : repository && !repository.toLowerCase().endsWith('.github.io') ? `/${repository}` : '';
const base = path === '' || path === '/' ? '/' : `/${path.replace(/^\/+|\/+$/g, '')}/`;

export default defineConfig({ base, plugins: [react()], build: { outDir: 'dist' } });
