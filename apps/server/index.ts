import "dotenv/config";
import cors from "cors";
import express from "express";
import { createServer } from "http";
import { createClient } from "redis";
import { Server } from "socket.io";
import authRoutes from "./routes/auth";
import candleRoutes from "./routes/candles";
import orderRoutes from "./routes/orders";

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

const subscriber = createClient({ url: "redis://localhost:6379" });

app.use(cors());
app.use(express.json());
app.use("/api/candles", candleRoutes);
app.use("/api/order", orderRoutes);
app.use("/api/auth", authRoutes);

function integerToDecimal(price: string) {
  return parseInt(price) / 100000000;
}

async function setupRedis() {
  await subscriber.connect();
  console.log("Redis subscriber connected");

  await subscriber.subscribe("candle-snapshots", (message) => {
    const candle = JSON.parse(message);
    const room = `candles-${candle.symbol}-${candle.timeframe}`;
    io.to(room).emit("candle-snapshot", candle);
  });

  await subscriber.subscribe("trades", (message) => {
    const trade = JSON.parse(message);
    const convertedTrade = {
      ...trade,
      price: integerToDecimal(trade.price),
    };
    const room = `trades-${trade.symbol}`;
    io.to(room).emit("live-trade", convertedTrade);
  });
}

io.on("connection", (socket) => {
  console.log("Client Connected:", socket.id);
  socket.on("subscribe-candles", async ({ symbol, timeframe }) => {
    const room = `candles-${symbol}-${timeframe}`;
    await socket.join(room);
    console.log(`Client subscribed to ${room}`);
  });

  socket.on("unsubscribe-candles", async ({ symbol, timeframe }) => {
    const room = `candles-${symbol}-${timeframe}`;
    await socket.leave(room);
    console.log(`Client unsubscribed from ${room}`);
  });

  socket.on("subscribe-trades", async ({ symbol }) => {
    const room = `trades-${symbol}`;
    await socket.join(room);
    console.log(`Client subscribed to live trades: ${room}`);
  });

  socket.on("unsubscribe-trades", async ({ symbol }) => {
    const room = `trades-${symbol}`;
    await socket.leave(room);
    console.log(`Client unsubscribed from ${room}`);
  });

  socket.on("disconnect", () => {
    console.log("Client Disconnected:", socket.id);
  });
});

app.get("/", (req, res) => {
  res.send("Hello World");
});

server.listen(3001, () => {
  console.log("Server with WebSocket is running on port 3001");
  setupRedis();
});
