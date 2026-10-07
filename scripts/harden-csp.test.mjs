import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hardenCspHtml } from './harden-csp.mjs';

const AUTO_CSP =
  "script-src 'strict-dynamic' 'sha256-example' https: 'unsafe-inline';object-src 'none';base-uri 'self';";

test('hardenCspHtml adds resource restrictions without changing Angular script policy', () => {
  const html = `<html><head><meta http-equiv="Content-Security-Policy" content="${AUTO_CSP}"></head></html>`;

  const hardened = hardenCspHtml(html);

  assert.match(hardened, /script-src 'strict-dynamic' 'sha256-example' https: 'unsafe-inline'/);
  assert.match(hardened, /default-src 'self'/);
  assert.match(hardened, /style-src 'self' 'unsafe-inline'/);
  assert.match(hardened, /img-src 'self' data:/);
  assert.match(hardened, /connect-src 'self'/);
  assert.match(hardened, /frame-src 'none'/);
  assert.match(hardened, /worker-src 'self'/);
  assert.match(hardened, /form-action 'none'/);
});

test('hardenCspHtml is idempotent', () => {
  const html = `<meta http-equiv="Content-Security-Policy" content="${AUTO_CSP}">`;
  const once = hardenCspHtml(html);
  const twice = hardenCspHtml(once);

  assert.equal(twice, once);
});

test('hardenCspHtml fails when autoCsp output is missing', () => {
  assert.throws(() => hardenCspHtml('<html></html>'), /autoCsp meta tag was not found/);
});
