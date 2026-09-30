// Placeholder page data for Phase 0 (docs/implementation-order.md).
// Empty/neutral states only — no invented compliance content (README core rule #1).
// `demo: true` shapes are used ONLY by the static export in site/ where every
// value is a clearly generic sample (no standard numbers, fees or deadlines).

const SAMPLE_JOURNEY_ID = '00000000-0000-0000-0000-000000000001';
const SAMPLE_TASK_ID = '00000000-0000-0000-0000-000000000002';

export function pageData(page, { demo = false } = {}) {
  switch (page) {
    case 'home':
      return {};
    case 'login':
      return { error: null };
    case 'register':
      return { error: null };
    case 'dashboard':
      return demo
        ? {
            user: { name: 'Explorer' },
            greeting: 'Welcome',
            hasJourney: true,
            products: [],
            activity: [],
          }
        : {
            user: { name: '' },
            greeting: 'Welcome',
            hasJourney: false,
            products: [],
            activity: [],
          };
    case 'profile':
      return { profile: null, saved: false, error: null };
    case 'products':
      return { products: [] };
    case 'journey-start':
      return {
        journeyId: SAMPLE_JOURNEY_ID,
        messages: [],
        question: null,
        step: 0,
        totalSteps: 5,
        planReady: false,
        plan: null,
        error: null,
      };
    case 'checklist':
      return {
        journeyId: SAMPLE_JOURNEY_ID,
        product: { name: demo ? 'Sample product' : '' },
        progressPct: 0,
        tasks: [],
        error: null,
      };
    case 'task-detail':
      return {
        journeyId: SAMPLE_JOURNEY_ID,
        task: {
          id: SAMPLE_TASK_ID,
          position: 1,
          title: 'Sample task',
          stage: 'understand',
          state: 'not_started',
          explanation: 'Task content will appear here once the checklist engine is live.',
          requirements: [],
          documents: [],
          sources: [],
        },
        completed: false,
        nextTask: null,
      };
    case 'task-assist':
      return {
        journeyId: SAMPLE_JOURNEY_ID,
        task: { id: SAMPLE_TASK_ID, position: 1, title: 'Sample task' },
        messages: [],
        citationsShown: 0,
      };
    case 'testing':
      return {
        journeyId: SAMPLE_JOURNEY_ID,
        tests: [],
        labs: null,
        selectedTestId: null,
        lastVerified: null,
        disclaimer: 'Verify current recognition and availability with BIS.',
      };
    case 'summary':
      return {
        journeyId: SAMPLE_JOURNEY_ID,
        product: { name: demo ? 'Sample product' : '', category: null },
        certification: { status: 'Guidance only — status is computed from your completed tasks.', note: null },
        standards: [],
        tests: [],
        documents: [],
        outstanding: [],
        sources: [],
        sourcesCount: 0,
      };
    case 'history':
      return { journeyId: SAMPLE_JOURNEY_ID, stages: [], page: 1, pageCount: 1 };
    case 'offline':
      return {};
    default:
      throw new Error(`Unknown page: ${page}`);
  }
}

export const sampleIds = { journeyId: SAMPLE_JOURNEY_ID, taskId: SAMPLE_TASK_ID };
