import { seed } from '../dev/seed.cjs';
import type { APIRequestContext } from '@playwright/test';
import { incomingLinkQuery, normaliseTraceId } from '../src/tempo';
import { test, expect } from './fixtures';

async function waitForLink(request: APIRequestContext, uid: string, target: string, source: string) {
  const end = Math.ceil(Date.now() / 1000);
  const search = new URLSearchParams({
    q: incomingLinkQuery(target),
    start: String(end - 3600),
    end: String(end),
  });
  // Tempo can look up a trace by ID before the span link is searchable.
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/datasources/proxy/uid/${uid}/api/search?${search}`);
        if (!response.ok()) {
          return [];
        }
        const body: { traces?: Array<{ traceID: string }> } = await response.json();
        return body.traces?.map(({ traceID }) => normaliseTraceId(traceID)) ?? [];
      },
      { timeout: 20_000, message: 'Wait for Tempo to index the synthetic span link' }
    )
    .toContain(source);
}

for (const entry of ['producer', 'worker'] as const) {
  test(`shows both traces on one waterfall starting from the ${entry}`, async ({
    gotoPage,
    page,
    readProvisionedDataSource,
  }) => {
    const { uid } = await readProvisionedDataSource({ fileName: 'tempo.yaml' });
    const traces = await seed();
    await waitForLink(page.request, uid, traces.producer, traces.worker);
    await gotoPage(`/?ds=${uid}&traceId=${traces[entry]}`);
    const waterfall = page.getByRole('region', { name: 'Linked trace waterfall' });
    await expect(waterfall.getByTestId('trace-lane')).toHaveCount(2);
    await expect(waterfall.getByTestId('trace-lane').nth(0)).toHaveAttribute('data-trace-id', traces.producer);
    await expect(waterfall.getByTestId('trace-lane').nth(1)).toHaveAttribute('data-trace-id', traces.worker);
    const connector = waterfall.getByTestId('cross-trace-link');
    await expect(connector).toHaveCount(1);
    await expect(connector.locator('path').first()).toHaveAttribute('d', / V /);
    await expect(connector.locator('path').last()).toHaveAttribute('d', / H /);
    if (entry === 'producer') {
      await waterfall.getByRole('button', { name: 'Collapse POST /checkout' }).click();
      await expect(waterfall.getByRole('button', { name: 'Inspect duration for publish order' })).toHaveCount(0);
      await expect(waterfall.getByTestId('cross-trace-link')).toHaveCount(0);
      await waterfall.getByRole('button', { name: 'Expand all' }).click();
      await expect(waterfall.getByTestId('cross-trace-link')).toHaveCount(1);
      await waterfall.getByRole('button', { name: 'Inspect duration for process order' }).click();
      const details = waterfall.getByTestId('trace-lane').nth(1).getByRole('region', { name: 'Span details' });
      await expect(details).toContainText('480 ms');
      await expect(details).toContainText(traces.worker);
      await details.getByRole('button', { name: 'Close span details' }).click();
      await waterfall.getByRole('textbox', { name: 'Filters' }).fill('process order');
      await expect(waterfall.getByText('1 of 3 spans')).toBeVisible();
      await waterfall.getByText('Show all spans', { exact: true }).click();
      await expect(waterfall.getByRole('button', { name: 'Inspect duration for POST /checkout' })).toHaveCount(0);
      await expect(waterfall.getByRole('button', { name: 'Inspect duration for process order' })).toBeVisible();
      await waterfall.getByRole('button', { name: 'Clear span filter' }).click();
      await expect(waterfall.getByRole('button', { name: 'Inspect duration for POST /checkout' })).toBeVisible();
      const minimap = waterfall.getByRole('group', { name: 'Trace minimap' });
      const box = await minimap.boundingBox();
      if (!box) {
        throw new Error('Trace minimap was not laid out');
      }
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + box.width * 0.55, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.95, y, { steps: 5 });
      await page.mouse.up();
      await expect(connector).toHaveCount(0);
      await waterfall.getByRole('button', { name: 'Reset selection' }).click();
      await expect(connector).toHaveCount(1);
    }
  });
}

test('expands and collapses a five-trace chain one hop at a time', async ({
  gotoPage,
  page,
  readProvisionedDataSource,
}) => {
  const { uid } = await readProvisionedDataSource({ fileName: 'tempo.yaml' });
  const { producer, worker, downstream } = await seed({ chain: true });
  const ids = [producer, worker, ...downstream.map(({ id }) => id)];
  await Promise.all(ids.slice(1).map((source, i) => waitForLink(page.request, uid, ids[i], source)));
  const queries: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    const query = url.searchParams.get('q');
    if (url.pathname.endsWith('/api/search') && query) {
      queries.push(query);
    }
  });

  await gotoPage(`/?ds=${uid}&traceId=${producer}`);
  const waterfall = page.getByRole('region', { name: 'Linked trace waterfall' });
  const lanes = waterfall.getByTestId('trace-lane');
  await expect(lanes).toHaveCount(2);
  expect(queries).toEqual([incomingLinkQuery(producer)]);
  for (const [index, service] of ['order-worker', 'payment-worker', 'invoice-worker'].entries()) {
    await waterfall.getByRole('button', { name: `Expand links for ${service}` }).click();
    await expect(lanes).toHaveCount(index + 3);
    await expect(lanes.last()).toContainText(downstream[index].service);
  }
  await expect(waterfall.getByTestId('cross-trace-link')).toHaveCount(4);
  expect(queries).toEqual(ids.slice(0, 4).map(incomingLinkQuery));
  await waterfall.getByRole('button', { name: 'Collapse links for order-worker' }).click();
  await expect(lanes).toHaveCount(2);
  await waterfall.getByRole('button', { name: 'Expand links for order-worker' }).click();
  await expect(lanes).toHaveCount(5);
  expect(queries).toHaveLength(4);
});

test('opens the linked waterfall from an Explore span', async ({ explorePage, page, readProvisionedDataSource }) => {
  const { uid } = await readProvisionedDataSource({ fileName: 'tempo.yaml' });
  const { worker } = await seed();
  const panes = {
    trace: {
      datasource: uid,
      queries: [{ refId: 'A', queryType: 'traceql', query: worker, datasource: { type: 'tempo', uid } }],
      range: { from: 'now-1h', to: 'now' },
    },
  };
  await explorePage.goto({ queryParams: new URLSearchParams({ schemaVersion: '1', panes: JSON.stringify(panes) }) });
  await page.getByText('process order', { exact: true }).first().click();
  const action = page.getByRole('link', { name: 'Open linked traces', exact: true }).first();
  await expect(action).toHaveAttribute('href', expect.stringContaining(`traceId=${worker}`));
  await action.click();
  await expect(page.getByRole('region', { name: 'Linked trace waterfall' }).getByTestId('trace-lane')).toHaveCount(2);
});

test('shows selected values in the search controls and submits the chosen window', async ({
  gotoPage,
  page,
  readProvisionedDataSource,
}) => {
  const { uid, name } = await readProvisionedDataSource({ fileName: 'tempo.yaml' });
  const { worker } = await seed();
  await gotoPage(`/?ds=${uid}&traceId=${worker}`);

  const source = page.getByRole('combobox', { name: 'Tempo data source' });
  const lookback = page.getByRole('combobox', { name: 'Incoming link search' });
  await expect(source).toHaveValue(name);
  await expect(lookback).toHaveValue('Last hour');
  await source.click();
  await page.getByRole('option', { name, exact: true }).click();
  await lookback.click();
  await page.getByRole('option', { name: 'Last 15 minutes', exact: true }).click();

  await page.getByRole('button', { name: 'Load traces' }).click();
  await expect(page).toHaveURL(/window=900/);
  await expect(source).toHaveValue(name);
  await expect(lookback).toHaveValue('Last 15 minutes');
});
