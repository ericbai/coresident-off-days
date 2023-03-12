import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import StatusError from "./status-error.js";

export async function getBlockInfoForDate(db, thisDay) {
    const params = {
        TableName: process.env.TABLE_BLOCKS,
        FilterExpression: "start_date <= :date And end_date >= :date",
        ExpressionAttributeValues: {
            ":date": thisDay.format(process.env.FORMAT_DATE),
        },
    };
    const { Count: numBlocks, Items: blocks } = await db.send(new ScanCommand(params));
    if (numBlocks === 0) {
        throw new StatusError(404, "Could not find a schedule block for that date");
    }
    return {
        blockName: blocks[0].block,
        isA: blocks[0].block.includes("A"),
        dayNumber: thisDay.diff(blocks[0].start_date, "day") + 1,
    };
}

export async function getScheduleForBlockName(db, blockName) {
    const params = {
        TableName: process.env.TABLE_SCHEDULES,
        ExpressionAttributeNames: {
            "#intern": "intern",
            "#blockName": blockName,
        },
        ProjectionExpression: "#intern,#blockName",
    };
    const { Items: schedules } = await db.send(new ScanCommand(params));
    return schedules.reduce(
        (obj, sched) => ((obj[sched.intern] = sched[blockName]), obj),
        Object.create(null)
    );
}

export async function getRotationsOffForBlockInfo(db, thisDay, isA, dayNumber) {
    const [offRotations, wbgOffRotations] = await Promise.all([
        getRotationsOffExceptWeinberg(db, isA, dayNumber),
        getWeinbergRotationsOff(db, thisDay),
    ]);
    return [...offRotations, ...wbgOffRotations].reduce(
        (obj, rotation) => ((obj[rotation.service] = rotation.position), obj),
        Object.create(null)
    );
}

export async function getRegexForOffRotations(db, offRotations) {
    // manually build out the filter expression with sequential named keys
    const maybeOffServiceKey = process.env.MAYBE_OFF_SERVICES,
        serviceExpParams = [...Object.keys(offRotations), maybeOffServiceKey].reduce(
            (obj, service, i) => ((obj[`:name${i}`] = service), obj),
            Object.create(null)
        ),
        params = {
            TableName: process.env.TABLE_SERVICE_REGEX,
            FilterExpression: `service IN (${Object.keys(serviceExpParams).join(", ")})`,
            ExpressionAttributeValues: serviceExpParams,
        };
    // run the built query
    const { Items: serviceExpObjs } = await db.send(new ScanCommand(params));
    // build regular expressions by replacing expression placeholders in returned expression objects
    const offExpArray = [];
    let maybeOffExp;
    serviceExpObjs.forEach(({ service, expression }) => {
        if (service === maybeOffServiceKey) {
            maybeOffExp = expression;
        } else {
            offExpArray.push(
                expression.replaceAll(process.env.EXP_PLACEHOLDER_POSITION, offRotations[service])
            );
        }
    });
    // build return object
    const regexByStatus = { maybeOff: new RegExp(maybeOffExp, "i") };
    if (offExpArray.length > 0) {
        regexByStatus.off = new RegExp(`(?:${offExpArray.join("|")})`, "i");
    }
    return regexByStatus;
}

// Helpers
// -------

async function getRotationsOffExceptWeinberg(db, isA, dayNumber) {
    const params = {
        TableName: process.env.TABLE_TEMPLATES,
        ExpressionAttributeNames: {
            "#service": "service",
            "#position": "position",
            "#dayNumber": String(dayNumber),
            "#blockTypeOne": "block_type",
            "#blockTypeTwo": "block_type",
        },
        FilterExpression:
            "#dayNumber = :dayNumber And (#blockTypeOne = :blockTypeOne Or #blockTypeTwo = :blockTypeTwo)",
        ExpressionAttributeValues: {
            ":dayNumber": process.env.POSITION_OFF,
            ":blockTypeOne": "Any",
            ":blockTypeTwo": isA ? "A" : "B",
        },
        ProjectionExpression: "#service,#position",
    };
    const { Items: offRotations } = await db.send(new ScanCommand(params));
    return offRotations;
}

async function getWeinbergRotationsOff(db, thisDay) {
    const params = {
        TableName: process.env.TABLE_TEMPLATES_WBG,
        ExpressionAttributeNames: {
            "#date": "date",
        },
        KeyConditionExpression: "#date = :date",
        ExpressionAttributeValues: {
            ":date": thisDay.format(process.env.FORMAT_DATE),
        },
    };
    const { Count: numTemplatesFound, Items: templates } = await db.send(new QueryCommand(params));
    if (numTemplatesFound === 0) {
        throw new StatusError(404, "Could not find any Weinberg schedules for given date");
    }
    return Object.keys(templates[0]).reduce(
        (array, dateOrServiceKey) => (
            templates[0][dateOrServiceKey] === process.env.POSITION_OFF &&
                array.push({
                    service: dateOrServiceKey,
                    position: "Days",
                }),
            array
        ),
        []
    );
}
