import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import dayjs from "dayjs";
import express from "express";
import serverless from "serverless-http";
import {
  getBlockInfoForDate,
  getRegexForOffRotations,
  getRotationsOffForBlockInfo,
  getScheduleForBlockName,
} from "./helpers/db.js";
import { tryBuildDayFromDate } from "./helpers/input.js";
import { classifySchedulesByStatus } from "./helpers/output.js";
import StatusError from "./helpers/status-error.js";

const app = express();
const db = DynamoDBDocumentClient.from(new DynamoDBClient());

// Load middleware
app.use(express.json());

// Given date within supported range, returns the residents that are off and those who are maybe off
app.get("/residents/:date", async (req, res) => {
  try {
    const thisDay = tryBuildDayFromDate(req.params.date),
      { blockName, isA, dayNumber } = await getBlockInfoForDate(db, thisDay);

    const [schedules, offRotations] = await Promise.all([
      getScheduleForBlockName(db, blockName),
      getRotationsOffForBlockInfo(db, thisDay, isA, dayNumber),
    ]);

    const regExpInfo = await getRegexForOffRotations(db, offRotations);

    res.json({
      metadata: {
        blockName,
        dayNumber,
        date: thisDay.format(process.env.FORMAT_DATE),
        minDate: dayjs(process.env.BOUND_MIN_DATE).format(process.env.FORMAT_DATE),
        maxDate: dayjs(process.env.BOUND_MAX_DATE).format(process.env.FORMAT_DATE),
      },
      ...classifySchedulesByStatus(regExpInfo, schedules),
    });
  } catch (error) {
    if (error instanceof StatusError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Handles not found routes
app.use((req, res, next) => res.status(404).json({ error: "Not found" }));

export const handler = serverless(app);
