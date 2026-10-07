import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { loadingContent, withPullDeadline } from '../src/widgetDeadline.js';

test('a pull within the deadline gets its own content', async () => {
  const content = { ttl_seconds: 60, components: [] };
  assert.equal(await withPullDeadline(async () => content, 50), content);
});

test('a pull past the deadline gets the loading card, never a dead one', async () => {
  const slow = () =>
    new Promise((resolve, reject) => setTimeout(() => reject(new Error('late')), 50));
  const content = await withPullDeadline(slow, 5);
  assert.equal(content.ttl_seconds, 15);
  assert.deepEqual(validateWidgetContent(loadingContent()), []);
});

test('an error within the deadline still reaches the core', async () => {
  await assert.rejects(
    withPullDeadline(async () => {
      throw new Error('wrong device');
    }, 50),
    /wrong device/,
  );
});
