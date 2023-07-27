import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import cors from "cors";
import dayjs from "dayjs";
import express from "express";
import serverless from "serverless-http";
import { getBlockInfoByRoleForDate } from "./helpers/db.js";
import { humanReadableMinDate, tryBuildDayFromDate } from "./helpers/input.js";
import {
  buildError,
  classifySchedulesForRoleAndBlockInfo,
  sortClassifiedSchedulesByName,
} from "./helpers/output.js";
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
      blockInfoByRole = await getBlockInfoByRoleForDate(db, thisDay);
    // 2. For each role, classify schedules by status (off, maybe off, not sure) and then aggregate
    // across roles into a unified `schedulesByStatus` object
    const schedulesByStatus = {
      [process.env.CLASSIFICATION_KEY_OFF]: [],
      [process.env.CLASSIFICATION_KEY_MAYBE_OFF]: [],
      [process.env.CLASSIFICATION_KEY_LIKELY_NOT_OFF]: [],
    };
    // for each role and it's associate block info...
    for (const [role, blockInfo] of Object.entries(blockInfoByRole)) {
      // ...classify schedules into classification keys...
      const classifiedSchedules = await classifySchedulesForRoleAndBlockInfo(
        db,
        thisDay,
        role,
        blockInfo
      );
      // ...and then merge into the aggregate `schedulesByStatus` object
      for (const classificationKey of Object.keys(schedulesByStatus)) {
        schedulesByStatus[classificationKey].push(
          ...(classifiedSchedules[classificationKey] || [])
        );
      }
    }
    // 3. Build JSON response object in expected format
    const fetchedDate = thisDay.format(process.env.FORMAT_DATE),
      minDate = humanReadableMinDate(),
      maxDate = dayjs(process.env.BOUND_MAX_DATE).format(process.env.FORMAT_DATE);
    res.json({
      "schedule-status": {
        id: fetchedDate,
        fetchedDate,
        minDate,
        maxDate,
        internBlockInfo: blockInfoByRole[process.env.ROLE_INTERN],
        residentBlockInfo: blockInfoByRole[process.env.ROLE_RESIDENT],
        ...sortClassifiedSchedulesByName(schedulesByStatus),
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
