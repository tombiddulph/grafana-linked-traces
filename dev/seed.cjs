const { randomBytes } = require('node:crypto');

async function seed({ chain = false } = {}) {
  const producer = chain ? `00${randomBytes(15).toString('hex')}` : randomBytes(16).toString('hex');
  const worker = randomBytes(16).toString('hex');
  const enqueue = randomBytes(8).toString('hex');
  const now = BigInt(Date.now() - 5000) * 1_000_000n;
  const span = (traceId, spanId, name, offsetMs, durationMs, extra) => ({
    traceId,
    spanId,
    name,
    startTimeUnixNano: (now + BigInt(offsetMs) * 1_000_000n).toString(),
    endTimeUnixNano: (now + BigInt(offsetMs + durationMs) * 1_000_000n).toString(),
    ...extra,
  });
  const resource = (service, spans) => ({
    resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }] },
    scopeSpans: [{ scope: { name: 'linked-traces-demo' }, spans }],
  });
  const request = randomBytes(8).toString('hex');
  const order = randomBytes(8).toString('hex');
  const orderSpans = [
    span(worker, order, 'process order', 900, 480, {
      kind: 5,
      links: [{ traceId: producer, spanId: enqueue }],
    }),
  ];
  const resourceSpans = [
    resource('checkout-api', [
      span(producer, request, 'POST /checkout', 0, 140, { kind: 2 }),
      span(producer, enqueue, 'publish order', 35, 40, { kind: 4, parentSpanId: request }),
    ]),
    resource('order-worker', orderSpans),
  ];
  const downstream = [];
  if (chain) {
    const publishPayment = randomBytes(8).toString('hex');
    orderSpans.push(span(worker, publishPayment, 'request payment', 1260, 55, { kind: 4, parentSpanId: order }));
    let previous = { traceId: worker, spanId: publishPayment };
    const steps = [
      {
        service: 'payment-worker',
        operation: 'capture payment',
        start: 1600,
        duration: 330,
        publish: 'request invoice',
      },
      { service: 'invoice-worker', operation: 'generate invoice', start: 2230, duration: 270, publish: 'queue email' },
      { service: 'email-worker', operation: 'send confirmation', start: 3020, duration: 420 },
    ];
    for (const step of steps) {
      const id = randomBytes(16).toString('hex');
      const rootSpan = randomBytes(8).toString('hex');
      const spans = [span(id, rootSpan, step.operation, step.start, step.duration, { kind: 5, links: [previous] })];
      if (step.publish) {
        const publishId = randomBytes(8).toString('hex');
        spans.push(
          span(id, publishId, step.publish, step.start + step.duration - 70, 30, { kind: 4, parentSpanId: rootSpan })
        );
        previous = { traceId: id, spanId: publishId };
      }
      resourceSpans.push(resource(step.service, spans));
      downstream.push({ service: step.service, id });
    }
  }
  const response = await fetch('http://127.0.0.1:4318/v1/traces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resourceSpans }),
  });
  const body = await response.json();
  if (!response.ok || Number(body.partialSuccess?.rejectedSpans)) {
    throw new Error(`OTLP export failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return { producer, worker, downstream };
}

module.exports = { seed };

if (require.main === module) {
  seed({ chain: true })
    .then(({ producer, worker, downstream }) => {
      for (const { service, id } of [
        { service: 'checkout-api (start here)', id: producer },
        { service: 'order-worker', id: worker },
        ...downstream,
      ]) {
        console.log(`${service}: http://localhost:3000/a/tombiddulph-linkedtraces-app/?traceId=${id}`);
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
