import "dotenv/config";
import { createClient } from "redis";
import { client, connectDB } from "./db/connection";
import { integerToPrice } from "./utils/price";

type Trade = {
  symbol: string;
  price: number;
  quantity: number;
  timestamp: number;
};

const subscriber = createClient({
  url: "redis://localhost:6379",
});

const processorClient = createClient({
  url: "redis://localhost:6379",
});

const candles = new Map<string, any>();
const BATCH_SIZE = 500;
const PROCESS_INTERVAL = 2000;

async function startConsumer() {
  try {
    await connectDB();
    await subscriber.connect();
    await processorClient.connect();
    console.log("Connected to Redis");
    await subscriber.subscribe("trades", (message) => {
      processorClient.rPush("trade_queue", message);
    });
    setInterval(processQueue, PROCESS_INTERVAL);
    startCandleBroadcasting();
  } catch (err) {
    console.error("Redis connection failed:", err);
  }
}

async function processQueue() {
  try {
    const execResults = await processorClient
      .multi()
      .lRange("trade_queue", 0, BATCH_SIZE - 1)
      .lTrim("trade_queue", BATCH_SIZE, -1)
      .exec();
    const tradeStr = execResults[0] as unknown as string[];
    if (!tradeStr || tradeStr.length === 0) {
      return;
    }
    const trades: Trade[] = tradeStr.map((trade) => JSON.parse(trade));
    trades.forEach((trade) => updateCandlesFromTrade(trade));
    const values = trades
      .map(
        (trade) =>
          `('${new Date(trade.timestamp).toISOString()}', '${trade.symbol}', ${trade.price}, ${trade.price}, ${trade.price}, ${trade.price}, ${trade.price})`,
      )
      .join(",");
    if (values.length === 0) {
      return;
    }
    const query = `INSERT INTO CANDLE_TABLE (time, symbol, price, high, low, open, close)
                       VALUES ${values};`;
    await client.query(query);
    console.log(`Successfully inserted ${trades.length} trades.`);
  } catch (error) {
    console.error("Error processing queue:", error);
  }
}

function updateCandlesFromTrade(trade: any) {
  const { symbol, price: priceInteger, timestamp } = trade;
  const price = integerToPrice(priceInteger);
  const intervals = [30, 60, 300, 3600];
  intervals.forEach((interval) => {
    const bucketKey = `${symbol}_${interval}`;
    const currentBucketStart =
      Math.floor(timestamp / (interval * 1000)) * (interval * 1000);

    const existingCandle = candles.get(bucketKey);
    if (existingCandle && existingCandle.startTime < currentBucketStart) {
      console.log(
        `Completed candle: ${bucketKey} (${existingCandle.startTime} -> ${currentBucketStart})`,
      );
      candles.delete(bucketKey);
    }

    if (!candles.has(bucketKey)) {
      candles.set(bucketKey, {
        symbol,
        interval,
        startTime: currentBucketStart,
        open: price,
        high: price,
        low: price,
        close: price,
      });
      console.log(` Created new candle: ${bucketKey}`);
    } else {
      const candle = candles.get(bucketKey);
      candle.high = Math.max(candle.high, price);
      candle.low = Math.min(candle.low, price);
      candle.close = price;
      console.log(` Updated candle: ${bucketKey}`);
    }
  });
}

async function broadcastCandleUpdates() {
  const timeframes = ["30s", "1m", "5m", "1h"];
  const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
  const intervals = [30, 60, 300, 3600];

  for (const symbol of symbols) {
    timeframes.forEach(async (timeframe, index) => {
      const interval = intervals[index];
      const bucketKey = `${symbol}_${interval}`;
      const currentCandle = candles.get(bucketKey);

      if (currentCandle) {
        const candleData = {
          time: currentCandle.startTime,
          symbol: currentCandle.symbol,
          timeframe,
          open: currentCandle.open,
          high: currentCandle.high,
          low: currentCandle.low,
          close: currentCandle.close,
          source: "snapshot",
          timestamp: Date.now(),
        };

        try {
          await processorClient.publish(
            "candle-snapshots",
            JSON.stringify(candleData),
          );
        } catch (error) {
          console.error(
            `Error broadcasting snapshot for ${symbol} ${timeframe}:`,
            error,
          );
        }
      }
    });
  }
}

async function startCandleBroadcasting() {
  setInterval(broadcastCandleUpdates, 250);
  console.log("Started candle broadcasting every 250ms");
}

startConsumer();
