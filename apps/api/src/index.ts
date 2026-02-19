import express from 'express';
import path from 'path';
import fs from 'fs';
import { type ViteDevServer } from 'vite';

const isProd = process.env.NODE_ENV === 'production';
const port = process.env.PORT || 5677;

async function startServer() {
    const app = express();

    let vite: ViteDevServer | null = null;
    if (!isProd) {
        const { createServer } = await import('vite');
        vite = await createServer({
            server: { middlewareMode: true },
            appType: 'custom',
            root: path.join(import.meta.dir, '../../web'),
        });
        app.use(vite.middlewares);
    } else {
        const compression = (await import('compression')).default;
        const sirv = (await import('sirv')).default;
        app.use(compression());
        app.use('/', sirv(path.join(import.meta.dir, '../../web/dist/client'), { extensions: [] }))
    }

    app.use('{*path}', async (req, res) => {
        try {
            const url = req.originalUrl.replace('/', '');
            let template, render;

            if (!isProd) {
                template = fs.readFileSync(path.join(import.meta.dir, '../../web/index.html'), 'utf-8');
                template = await vite!.transformIndexHtml(url, template);
                render = (await vite!.ssrLoadModule('/src/entry-server.tsx')).render;
            } else {
                template = fs.readFileSync(path.join(import.meta.dir, '../../web/dist/client/index.html'), 'utf-8');
                const serverEntryPoint = path.join(import.meta.dir, '../../web/dist/server/entry-server.js');
                render = (await import(serverEntryPoint)).render;
            }

            const appHtml = await render(url);

            const html = template.replace(`<!--app-html-->`, appHtml);

            res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
        }
        catch (e: any) {
            console.error(e.stack);
            res.status(500).end(e.stack);
        }
    });

    const server = app.listen(port, () => {
        console.log(`Server started at http://localhost:${port} in ${isProd ? 'production' : 'development'} mode`);
    });

    process.on('SIGINT', () => {
        console.log('Shutting down server...');
        server.close(() => process.exit(0));
    });
}

startServer();