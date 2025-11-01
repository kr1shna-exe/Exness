import { Queue } from 'bullmq';
import { redis } from './db/connection';
import { processPrice } from './utils/price';

const priceQueue = new Queue('price-queue', { connection: redis });

priceQueue.process(async (job) => {
  await processPrice(job.data);
});

console.log('Price pooler started. Awaiting price data...');
