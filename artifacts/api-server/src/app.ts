import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Photos are transient, resized data URLs; bytes are never stored in PostgreSQL.
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
const handleError: ErrorRequestHandler = (err, req, res, _next) => {
  req.log.error({ error: err instanceof Error ? err.name : "UnknownError" }, "Request failed");
  const badJson = err?.type === "entity.parse.failed";
  const tooLarge = err?.type === "entity.too.large";
  res.status(tooLarge ? 413 : badJson ? 400 : 500).json({ error: tooLarge ? "Photo is too large. Choose an image smaller than 3 MB after resizing." : badJson ? "Invalid JSON" : "Something went wrong. Please try again." });
};
app.use(handleError);

export default app;
