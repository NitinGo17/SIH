// No-JS form fallbacks for auth and profile (templates POST to page routes;
// the JS islands call the /api/* endpoints instead — docs/templates README).
import { renderPage } from '../render.js';
import { sendError } from '../lib/errors.js';
import * as authService from '../services/auth.js';
import { doLogin, doRegister } from './api/auth.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../plugins/auth.js';

const EMAIL_RE = /^[^@ ]+@[^@ ]+[.][^@ ]+$/;

function loginPageHtml(error) {
  return renderPage('login', { error }, { title: 'Log in · ManakAI', description: 'Log in to continue your compliance journey.' });
}

function registerPageHtml(error) {
  return renderPage('register', { error }, { title: 'Create an account · ManakAI', description: 'Create your ManakAI account and start your compliance journey.' });
}

function formStr(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** @param {import('fastify').FastifyInstance} fastify */
export default async function pageAuthRoutes(fastify) {
  fastify.post('/login', async (req, reply) => {
    if (!fastify.dbEnabled) return sendError(reply, 'UNAVAILABLE');
    const email = formStr(req.body?.email).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!EMAIL_RE.test(email) || password.length === 0) {
      return reply.code(401).type('text/html; charset=utf-8').send(loginPageHtml('Please enter a valid email and password.'));
    }

    const result = await doLogin(fastify, { email, password }, req.ip);
    if (result.error) {
      const messages = {
        INVALID_CREDENTIALS: 'Email or password is incorrect.',
        RATE_LIMITED: 'Too many attempts. Please try again in 15 minutes.',
      };
      return reply.code(result.status).type('text/html; charset=utf-8').send(loginPageHtml(messages[result.error.code] ?? 'Login failed.'));
    }

    reply.setCookie(SESSION_COOKIE, result.setSession, sessionCookieOptions());
    return reply.redirect(result.body.profileComplete ? '/dashboard' : '/profile', 303);
  });

  fastify.post('/register', async (req, reply) => {
    if (!fastify.dbEnabled) return sendError(reply, 'UNAVAILABLE');
    const name = formStr(req.body?.name, 100);
    const email = formStr(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (name.length === 0 || !EMAIL_RE.test(email) || password.length < 8) {
      return reply.code(400).type('text/html; charset=utf-8').send(registerPageHtml('Please fill in your name, a valid email, and a password of at least 8 characters.'));
    }

    const result = await doRegister(fastify, { name, email, password });
    if (result.error) {
      const messages = { EMAIL_TAKEN: 'An account with this email already exists.' };
      return reply.code(result.status).type('text/html; charset=utf-8').send(registerPageHtml(messages[result.error.code] ?? 'Registration failed.'));
    }

    reply.setCookie(SESSION_COOKIE, result.setSession, sessionCookieOptions());
    return reply.redirect('/profile', 303); // first login: complete your profile
  });

  fastify.post('/logout', async (req, reply) => {
    if (fastify.dbEnabled && req.sessionToken) {
      await authService.deleteSession(fastify.db, req.sessionToken).catch(() => {});
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.redirect('/', 303);
  });

  fastify.post('/profile', async (req, reply) => {
    if (!fastify.dbEnabled) return sendError(reply, 'UNAVAILABLE');
    if (!req.user) return reply.redirect('/login');

    const businessName = formStr(req.body?.businessName, 200) || null;
    const businessType = formStr(req.body?.businessType, 50) || null;
    const industry = formStr(req.body?.industry, 200) || null;

    if (businessType && !authService.isBusinessType(businessType)) {
      return reply.redirect('/profile?error=invalid_type', 303);
    }
    await authService.updateProfile(fastify.db, req.user.id, { businessName, businessType, industry });
    return reply.redirect('/profile?saved=1', 303);
  });
}
