// Orchestrator unit tests — validation gate + mock provider (no DB, no LLM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validationGate } from '../ai/orchestrator.js';
import { mockEmbedding, aiConfig, mockChat } from '../ai/provider.js';

const ROWS = [
  { source_id: 'src-1', title: 'IS 10322-5-2', authority: 'BIS', url: 'https://bis.gov.in/a', verified: false, text: 'led luminaires scope clause' },
  { source_id: 'src-2', title: 'IS 302-2-1', authority: 'BIS', url: 'https://bis.gov.in/b', verified: true, text: 'household appliances safety fee schedule' },
];

test('gate drops requirements citing unknown sources into unknown confidence', () => {
  const out = validationGate([
    { type: 'standard', title: 'IS 99999 Fake', confidence: 'confirmed', source_ids: ['nope'] },
  ], ROWS);
  assert.equal(out.length, 1);
  assert.equal(out[0].confidence, 'unknown');
  assert.equal(out[0].source_ids, undefined);
});

test('gate keeps sourced requirements; confirmed requires verified rows', () => {
  const out = validationGate([
    { type: 'standard', title: 'IS 302-2-1', confidence: 'confirmed', source_ids: ['src-2'] },
    { type: 'standard', title: 'IS 10322-5-2', confidence: 'confirmed', source_ids: ['src-1'] },
  ], ROWS);
  assert.equal(out[0].confidence, 'confirmed');   // verified source may back confirmed
  assert.equal(out[1].confidence, 'likely');      // unverified row is demoted
});

test('gate strips fees absent from source text', () => {
  const out = validationGate([
    { type: 'standard', title: 'IS 10322-5-2', fee: 5000, source_ids: ['src-1'], confidence: 'likely' },
  ], ROWS);
  assert.equal(out[0].fee, undefined);
});

test('gate rejects malformed requirements', () => {
  const out = validationGate([null, { type: 'bogus', title: 'x' }, { type: 'standard' }, 'junk'], ROWS);
  assert.equal(out.length, 0);
});

test('mock provider defaults when no key is configured', () => {
  const cfg = aiConfig();
  assert.ok(['mock', 'openai'].includes(cfg.provider));
  assert.equal(cfg.timeoutMs >= 1000, true);
});

test('mock embeddings are 768-dim and deterministic', () => {
  const a = mockEmbedding('led luminaires');
  const b = mockEmbedding('led luminaires');
  assert.equal(a.length, 768);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, mockEmbedding('steel bottles'));
});

test('mock chat only uses retrieved rows (never invents)', () => {
  const out = mockChat([
    { role: 'system', content: 'TASK: discovery RETRIEVED_CONTEXT: ' + JSON.stringify({ rows: ROWS, questionCount: 5 }) },
    { role: 'user', content: 'LED bulbs' },
  ]);
  assert.equal(out.phase, 'done');
  assert.equal(out.requirements.length, 2);
  assert.ok(out.requirements.every((r) => ROWS.some((row) => row.source_id === r.source_ids[0])));
});
