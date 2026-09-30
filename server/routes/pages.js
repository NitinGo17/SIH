// SSR page registry (Phase 0: placeholder wiring per docs/architecture.md §5.1
// and server/templates/README.md). Real data arrives with Phases 2–7.
//
// The registry is consumed by TWO places that must render identically:
//   1. routes/pages.js  — registers each entry as a Fastify GET route
//   2. scripts/export-static.js — renders each entry to static HTML
import { pageData } from '../placeholders.js';
import { renderPage } from '../render.js';

const J = '00000000-0000-0000-0000-000000000001'; // sample journey id (export/demo only)
const T = '00000000-0000-0000-0000-000000000002'; // sample task id (export/demo only)

/**
 * Page registry.
 * route: Fastify route pattern; url: concrete sample URL used by the exporter.
 */
export const PAGES = [
  {
    route: '/',
    url: '/',
    template: 'home',
    data: () => pageData('home'),
    meta: {
      title: 'ManakAI — From Product to Compliance',
      description:
        'AI-guided BIS compliance checklists for Indian MSMEs, manufacturers and importers. Every step traceable to its official source.',
    },
  },
  {
    route: '/login',
    url: '/login',
    template: 'login',
    data: () => pageData('login'),
    meta: { title: 'Log in · ManakAI', description: 'Log in to continue your compliance journey.' },
  },
  {
    route: '/register',
    url: '/register',
    template: 'register',
    data: () => pageData('register'),
    meta: { title: 'Create an account · ManakAI', description: 'Create your ManakAI account and start your compliance journey.' },
  },
  {
    route: '/dashboard',
    url: '/dashboard',
    template: 'dashboard',
    data: () => pageData('dashboard'),
    meta: { title: 'Dashboard · ManakAI', description: 'Your products and journeys at a glance.', appNav: 'home', mainClass: 'has-bottom-nav' },
  },
  {
    route: '/profile',
    url: '/profile',
    template: 'profile',
    data: () => pageData('profile'),
    meta: { title: 'Profile · ManakAI', description: 'Your business profile.', appNav: 'profile', mainClass: 'has-bottom-nav' },
  },
  {
    route: '/products',
    url: '/products',
    template: 'products',
    data: () => pageData('products'),
    meta: { title: 'My products · ManakAI', description: 'Products you are guiding through compliance.' },
  },
  {
    route: '/journey/start',
    url: '/journey/start',
    template: 'journey-start',
    data: () => pageData('journey-start'),
    meta: { title: 'Start the Journey · ManakAI', description: 'Describe your product and get a compliance checklist.', appNav: 'journey', mainClass: 'has-bottom-nav' },
  },
  {
    route: '/journey/:id/checklist',
    url: `/journey/${J}/checklist`,
    template: 'checklist',
    data: () => pageData('checklist'),
    meta: { title: 'Checklist · ManakAI', description: 'Your personalized compliance checklist.' },
  },
  {
    route: '/journey/:id/task/:taskId',
    url: `/journey/${J}/task/${T}`,
    template: 'task-detail',
    data: () => pageData('task-detail'),
    meta: { title: 'Task · ManakAI', description: 'Task detail.' },
  },
  {
    route: '/journey/:id/task/:taskId/assist',
    url: `/journey/${J}/task/${T}/assist`,
    template: 'task-assist',
    data: () => pageData('task-assist'),
    meta: { title: 'Ask ManakAI · ManakAI', description: 'Task-scoped guidance.' },
  },
  {
    route: '/journey/:id/testing',
    url: `/journey/${J}/testing`,
    template: 'testing',
    data: () => pageData('testing'),
    meta: { title: 'Testing & labs · ManakAI', description: 'Required tests and BIS-recognized laboratories.' },
  },
  {
    route: '/journey/:id/summary',
    url: `/journey/${J}/summary`,
    template: 'summary',
    data: () => pageData('summary'),
    meta: { title: 'Journey summary · ManakAI', description: 'Your compliance journey summary.' },
  },
  {
    route: '/journey/:id/history',
    url: `/journey/${J}/history`,
    template: 'history',
    data: () => pageData('history'),
    meta: { title: 'Journey history · ManakAI', description: 'Your consultation history by stage.' },
  },
  {
    route: '/offline',
    url: '/offline',
    template: 'offline',
    data: () => pageData('offline'),
    meta: { title: 'Offline · ManakAI', description: 'ManakAI is offline.' },
  },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {import('fastify').FastifyInstance} fastify */
export default async function pageRoutes(fastify) {
  for (const page of PAGES) {
    fastify.get(page.route, async (req, reply) => {
      // journey-scoped routes validate ids (defense in depth for Phase 0;
      // ownership checks arrive with auth in Phase 2)
      if (page.route.includes(':id') && !UUID_RE.test(req.params.id)) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Journey not found.' } });
      }
      if (page.route.includes(':taskId') && !UUID_RE.test(req.params.taskId)) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Task not found.' } });
      }
      reply.type('text/html; charset=utf-8').send(render(page));
    });
  }
}

/**
 * Render a registry entry to a full HTML document.
 * @param {{ template: string, data: () => object, meta: object }} page
 */
export function render(page) {
  return renderPage(page.template, page.data(), page.meta);
}
