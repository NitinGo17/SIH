// Eta template rendering, per server/templates/README.md contract:
// 1. render the page body template with its data
// 2. render layout.eta passing the body as `content`
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Eta } from 'eta';

const here = path.dirname(fileURLToPath(import.meta.url));
const viewsDir = path.join(here, 'templates');

const eta = new Eta({
  views: viewsDir,
  // <%- %> auto-escape stays ON (Eta default): all user/AI content is escaped,
  // only <%~ %> raw output is used for pre-rendered body content.
});

/**
 * Render a page into layout.eta.
 *
 * @param {string} template - template name relative to server/templates (e.g. 'home')
 * @param {object} data     - data for the body template
 * @param {object} meta     - layout fields: { title, description, og, user, appNav, mainClass }
 * @returns {string} full HTML document
 */
export function renderPage(template, data, meta) {
  const content = eta.render(template, data ?? {});
  return eta.render('layout', {
    title: meta.title,
    description: meta.description,
    og: meta.og || '',
    user: meta.user ?? null,
    appNav: meta.appNav ?? null,
    mainClass: meta.mainClass || '',
    content,
  });
}
