// SSR page registry (docs/architecture.md §5.1, server/templates/README.md).
//
// The registry is consumed by TWO places that must render identically:
//   1. routes/pages.js  — registers each entry as a Fastify GET route
//   2. scripts/export-static.js — renders each entry to static HTML
//
// Phase 2: session-aware rendering — `data(req)`/`meta(req)` receive the
// request (null in the static export) so app pages can show the real user.
import { pageData } from '../placeholders.js';
import * as productsSvc from '../services/products.js';
import * as checklistSvc from '../services/checklist.js';


import { renderPage } from '../render.js';

const J = '00000000-0000-0000-0000-000000000001'; // sample journey id (export/demo only)
const T = '00000000-0000-0000-0000-000000000002'; // sample task id (export/demo only)

/** Time-of-day greeting in IST (the product's audience). */
function greeting() {
  const istHour = new Date(Date.now() + 5.5 * 3600_000).getUTCHours();
  if (istHour < 5) return 'Working late';
  if (istHour < 12) return 'Good morning';
  if (istHour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Page registry.
 * route: Fastify route pattern; url: concrete sample URL for the exporter;
 * auth: requires a session (redirects to /login); profile page also allows ?saved=1.
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
    data: (req) => (req?.query?.error ? { error: String(req.query.error) } : pageData('login')),
    meta: { title: 'Log in · ManakAI', description: 'Log in to continue your compliance journey.' },
  },
  {
    route: '/register',
    url: '/register',
    template: 'register',
    data: (req) => (req?.query?.error ? { error: String(req.query.error) } : pageData('register')),
    meta: { title: 'Create an account · ManakAI', description: 'Create your ManakAI account and start your compliance journey.' },
  },
  {
    route: '/dashboard',
    url: '/dashboard',
    auth: true,
    template: 'dashboard',
    data: (req) =>
      req?.user
        ? {
            user: { name: req.user.display_name },
            greeting: greeting(),
            hasJourney: false,
            products: [], // Phase 3
            activity: [], // Phase 3
          }
        : pageData('dashboard'),
    meta: (req) => ({
      title: 'Dashboard · ManakAI',
      description: 'Your products and journeys at a glance.',
      appNav: 'home',
      mainClass: 'has-bottom-nav',
      user: req?.user ? { name: req.user.display_name } : null,
    }),
  },
  {
    route: '/profile',
    url: '/profile',
    auth: true,
    template: 'profile',
    data: () => ({ profile: null, saved: false, error: null }), // real data injected by the route handler
    meta: (req) => ({
      title: 'Profile · ManakAI',
      description: 'Your business profile.',
      appNav: 'profile',
      mainClass: 'has-bottom-nav',
      user: req?.user ? { name: req.user.display_name } : null,
    }),
  },
  {
    route: '/products',
    url: '/products',
    auth: true,
    template: 'products',
    data: () => ({ products: [] }), // Phase 3
    meta: (req) => ({
      title: 'My products · ManakAI',
      description: 'Products you are guiding through compliance.',
      user: req?.user ? { name: req.user.display_name } : null,
    }),
  },
  {
    route: '/journey/start',
    url: '/journey/start',
    auth: true,
    template: 'journey-start',
    data: () => pageData('journey-start'),
    meta: (req) => ({
      title: 'Start the Journey · ManakAI',
      description: 'Describe your product and get a compliance checklist.',
      appNav: 'journey',
      mainClass: 'has-bottom-nav',
      user: req?.user ? { name: req.user.display_name } : null,
    }),
  },
  {
    route: '/journey/:id/checklist',
    url: `/journey/${J}/checklist`,
    auth: true,
    template: 'checklist',
    data: () => pageData('checklist'),
    meta: (req) => ({
      title: 'Checklist · ManakAI',
      description: 'Your personalized compliance checklist.',
      user: req?.user ? { name: req.user.display_name } : null,
    }),
  },
  {
    route: '/journey/:id/task/:taskId',
    url: `/journey/${J}/task/${T}`,
    auth: true,
    template: 'task-detail',
    data: () => pageData('task-detail'),
    meta: (req) => ({
      title: 'Task · ManakAI',
      description: 'Task detail.',
      user: req?.user ? { name: req.user.display_name } : null,
    }),
  },
  {
    route: '/journey/:id/task/:taskId/assist',
    url: `/journey/${J}/task/${T}/assist`,
    auth: true,
    template: 'task-assist',
    data: () => pageData('task-assist'),
    meta: (req) => ({
      title: 'Ask ManakAI · ManakAI',
      description: 'Task-scoped guidance.',
      user: req?.user ? { name: req.user.display_name } : null,
    }),
  },
  {
    route: '/journey/:id/testing',
    url: `/journey/${J}/testing`,
    auth: true,
    template: 'testing',
    data: () => pageData('testing'),
    meta: (req) => ({
      title: 'Testing & labs · ManakAI',
      description: 'Required tests and BIS-recognized laboratories.',
      user: req?.user ? { name: req.user.display_name } : null,
    }),
  },
  {
    route: '/journey/:id/summary',
    url: `/journey/${J}/summary`,
    auth: true,
    template: 'summary',
    data: () => pageData('summary'),
    meta: (req) => ({
      title: 'Journey summary · ManakAI',
      description: 'Your compliance journey summary.',
      user: req?.user ? { name: req.user.display_name } : null,
    }),
  },
  {
    route: '/journey/:id/history',
    url: `/journey/${J}/history`,
    auth: true,
    template: 'history',
    data: () => pageData('history'),
    meta: (req) => ({
      title: 'Journey history · ManakAI',
      description: 'Your consultation history by stage.',
      user: req?.user ? { name: req.user.display_name } : null,
    }),
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

/** Render a registry entry (no Fastify involved — also used by the static exporter). */
export function render(page, req = null) {
  const data = typeof page.data === 'function' ? page.data(req) : page.data;
  const meta = typeof page.meta === 'function' ? page.meta(req) : page.meta;
  return renderPage(page.template, data, meta);
}

/** @param {import('fastify').FastifyInstance} fastify */
export default async function pageRoutes(fastify) {
  const real = async (route, fn) => {
    const page = PAGES.find((p) => p.route === route);
    if (!page) return;
    const fallback = page.data;
    page.data = async (req) => {
      if (!req?.user || !fastify.dbEnabled) return fallback(req);
      try {
        return await fn(req);
      } catch (e) {
        req.log.warn({ err: e }, `data for ${route} failed`);
        const data = await fallback(req);
        return { ...data, error: 'CHECKLIST_UNAVAILABLE' };
      }
    };
  };

  real('/dashboard', async (req) => ({
    user: { name: req.user.display_name },
    greeting: greeting(),
    hasJourney: true,
    products: (await productsSvc.listProducts(fastify.db, req.user.id)).map((p) => ({
      id: p.id, name: p.name, category: p.category, journeyProgress: p.journeyProgress,
      currentStage: p.currentStage ?? 'Not started', nextAction: null, journeyId: p.journeyId,
    })),
    activity: await productsSvc.recentActivity(fastify.db, req.user.id),
  }));

  real('/products', async (req) => ({
    products: (await productsSvc.listProducts(fastify.db, req.user.id)).map((p) => ({
      id: p.id, name: p.name, category: p.category, origin: p.origin,
      complianceStage: p.complianceStage, journeyProgress: p.journeyProgress, journeyId: p.journeyId,
    })),
  }));

  real('/journey/:id/checklist', async (req) =>
    checklistSvc.getChecklist(fastify.db, req.user.id, req.params.id)
      .then((c) => c ?? Promise.reject(new Error('not found')))
  );

  real('/journey/:id/task/:taskId', async (req) => {
    const task = await checklistSvc.getTask(fastify.db, req.user.id, req.params.taskId);
    return {
      journeyId: req.params.id,
      task,
      completed: task.state === 'completed',
      nextTask: task.nextTask,
    };
  });

  real('/journey/:id/testing', async (req) => {
    const j = await productsSvc.getJourney(fastify.db, req.user.id, req.params.id);
    if (!j) throw new Error('not found');
    const { rows } = await fastify.db.query(
      `SELECT t.id, t.name, t.purpose, jt.status FROM journey_tests jt
       JOIN tests t ON t.id = jt.test_id WHERE jt.journey_id = $1`, [req.params.id]);
    return {
      journeyId: req.params.id,
      tests: rows.map((r) => ({ testId: r.id, name: r.name, purpose: r.purpose, status: r.status })),
      labs: null, selectedTestId: null, lastVerified: null,
      disclaimer: 'Verify current recognition and availability with BIS.',
    };
  });

  real('/journey/:id/history', async (req) => {
    const j = await productsSvc.getJourney(fastify.db, req.user.id, req.params.id);
    if (!j) throw new Error('not found');
    const { rows } = await fastify.db.query(
      `SELECT c.stage, m.role, m.content, m.created_at FROM conversations c
       JOIN messages m ON m.conversation_id = c.id
       WHERE c.journey_id = $1 ORDER BY c.stage, m.created_at`, [req.params.id]);
    const stages = ['discovery', 'requirements', 'testing', 'documentation', 'certification']
      .map((name) => ({ name, messages: [], lastActive: null }));
    for (const r of rows) {
      const st = stages.find((x) => x.name === r.stage);
      if (st) {
        st.messages.push({ role: r.role, content: r.content });
        st.lastActive = r.created_at;
      }
    }
    return { journeyId: req.params.id, stages, page: 1, pageCount: 1 };
  });

  // Profile needs its real data (Phase 2) — handled here, not by the registry default.
  const profilePage = PAGES.find((p) => p.route === '/profile');
  const originalData = profilePage.data;
  profilePage.data = async (req) => {
    if (!req?.user || !fastify.dbEnabled) return originalData(req);
    const { getProfile } = await import('../services/auth.js');
    return { profile: await getProfile(fastify.db, req.user.id), saved: req.query?.saved === '1', error: null };
  };

  for (const page of PAGES) {
    fastify.get(page.route, async (req, reply) => {
      // guards (Phase 2): auth + first-login profile setup redirect
      if (page.auth) {
        if (!req.user) return reply.redirect('/login');
        if (!req.user.profile_complete && page.route !== '/profile') {
          return reply.redirect('/profile');
        }
      }
      if ((page.route === '/login' || page.route === '/register') && req.user) {
        return reply.redirect('/dashboard');
      }

      // journey-scoped routes validate ids (defense in depth; ownership
      // checks arrive with the products/journeys phases)
      if (page.route.includes(':id') && !UUID_RE.test(req.params.id)) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Journey not found.' } });
      }
      if (page.route.includes(':taskId') && !UUID_RE.test(req.params.taskId)) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Task not found.' } });
      }

      const data = await page.data(req);
      const meta = typeof page.meta === 'function' ? page.meta(req) : page.meta;
      reply.type('text/html; charset=utf-8').send(renderPage(page.template, data, meta));
    });
  }
}
