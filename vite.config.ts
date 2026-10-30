import fs from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

function serveTestEpubsPlugin(): Plugin {
    const testEpubDir = path.resolve(import.meta.dirname, 'test_epub');

    return {
        name: 'serve-test-epubs',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (!req.url) {
                    next();
                    return;
                }

                if (req.url === '/api/test-epubs' && req.method === 'GET') {
                    try {
                        if (!fs.existsSync(testEpubDir)) {
                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify([]));
                            return;
                        }
                        const files = fs
                            .readdirSync(testEpubDir, { withFileTypes: true })
                            .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.epub'))
                            .map((entry) => ({
                                name: entry.name,
                                size: fs.statSync(path.join(testEpubDir, entry.name)).size,
                            }));
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify(files));
                    } catch {
                        res.statusCode = 500;
                        res.end(JSON.stringify([]));
                    }
                    return;
                }

                if (req.url.startsWith('/api/test-epubs/') && req.method === 'GET') {
                    const encodedName = req.url.slice('/api/test-epubs/'.length);
                    const fileName = decodeURIComponent(encodedName);
                    const safeName = path.basename(fileName);
                    const fullPath = path.join(testEpubDir, safeName);

                    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
                        const stat = fs.statSync(fullPath);
                        res.setHeader('Content-Type', 'application/epub+zip');
                        res.setHeader('Content-Length', String(stat.size));
                        fs.createReadStream(fullPath).pipe(res);
                        return;
                    }
                    res.statusCode = 404;
                    res.end('Not found');
                    return;
                }

                next();
            });
        },
    };
}

export default defineConfig({
    base: './',
    plugins: [react(), tailwindcss(), serveTestEpubsPlugin()],
    test: {
        environment: 'jsdom',
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
});

