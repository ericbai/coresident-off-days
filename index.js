import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import cors from "cors";
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
import { buildError, classifySchedulesByStatus } from "./helpers/output.js";
import StatusError from "./helpers/status-error.js";

const app = express();
const db = DynamoDBDocumentClient.from(new DynamoDBClient());

// Load middleware
app.use(cors()); // adds appropriate CORS headers
app.use(express.json()); // for parsing application/json request bodies

// validate against default pin
app.post("/validate", async (req, res) => {
  const pin = String(req.body?.pin);
  if (pin === process.env.DEFAULT_PIN) {
    res.status(200).end();
  } else {
    res.status(403).json(buildError("The password is not correct"));
  }
});

// Given date within supported range, returns the residents that are off and those who are maybe off
app.get("/schedule-status/:date", async (req, res) => {
  try {
    // 1. get basic information given valid date
    const thisDay = tryBuildDayFromDate(req.params.date),
      { blockName, isA, dayNumber } = await getBlockInfoForDate(db, thisDay);
    // 2. fetch resident schedules and rotations that have scheduled off day
    const [schedules, offRotations] = await Promise.all([
      getScheduleForBlockName(db, blockName),
      getRotationsOffForBlockInfo(db, thisDay, isA, dayNumber),
    ]);
    // 3. build regex for each category (off vs maybe off) and group residents into these categories
    const regExpInfo = await getRegexForOffRotations(db, offRotations),
      residentsByStatus = classifySchedulesByStatus(regExpInfo, schedules),
      fetchedDate = thisDay.format(process.env.FORMAT_DATE),
      minDate = dayjs(process.env.BOUND_MIN_DATE).format(process.env.FORMAT_DATE),
      maxDate = dayjs(process.env.BOUND_MAX_DATE).format(process.env.FORMAT_DATE);
    // 4. Build JSON response object in expected format
    res.json({
      "schedule-status": {
        id: fetchedDate,
        fetchedDate,
        minDate,
        maxDate,
        blockName,
        dayNumber,
        ...residentsByStatus,
      },
    });
  } catch (error) {
    if (error instanceof StatusError) {
      res.status(error.statusCode).json(buildError(error.message));
    } else {
      res.status(500).json(buildError(error.message));
    }
  }
});

// Handles not found routes
app.use((req, res, next) => res.status(404).json(buildError("Not found")));

export const handler = serverless(app);
