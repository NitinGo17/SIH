// Consistent error envelope from docs/api.md:
//   { "error": { "code": "...", "message": "..." } }
export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  CSRF_FAILED: 403,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  CONFLICT: 409,
  UNAVAILABLE: 503, // backend dependency (database) not configured/reachable
  AI_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
};

/**
 * @param {import('fastify').FastifyReply} reply
 * @param {string} code - one of the codes above
 * @param {string} [message] - human-readable message (defaults per code)
 */
export function sendError(reply, code, message) {
  const status = ERROR_STATUS[code] ?? 500;
  const messages = {
    VALIDATION_ERROR: 'Please check the submitted fields.',
    UNAUTHENTICATED: 'You need to log in to do that.',
    INVALID_CREDENTIALS: 'Email or password is incorrect.',
    FORBIDDEN: 'You do not have access to this resource.',
    CSRF_FAILED: 'Request could not be verified. Please reload the page and try again.',
    NOT_FOUND: 'Resource not found.',
    EMAIL_TAKEN: 'An account with this email already exists.',
    UNAVAILABLE: 'This service is temporarily unavailable.',
    RATE_LIMITED: 'Too many attempts. Please try again in 15 minutes.',
    QUOTA_EXCEEDED: 'Daily quota reached. Please try again tomorrow.',
  };
  return reply.code(status).send({ error: { code, message: message ?? messages[code] ?? 'Request failed.' } });
}
