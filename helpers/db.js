import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import StatusError from "./status-error.js";

/**
 * Gets basic information about a block given a date
 * @param  {DynamoDBDocumentClient} db      Db client
 * @param  {DayJS} thisDay                  DayJS object
 * @return {Object}                         With keys `blockName`, `isA`, and `dayNumber`
 */
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

/**
 * Gets schedule assignments for a given block name
 * @param  {DynamoDBDocumentClient} db      DB client
 * @param  {String} blockName               Block's name (e.g., 9A, 10B, etc)
 * @return {Object}                         Keys are intern names, values are assigned rotation and position
 */
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

/**
 * Get rotations that have a schedule off day for a given date
 * @param  {DynamoDBDocumentClient}  db        DB client
 * @param  {DayJS}  thisDay                    DayJS date object
 * @param  {Boolean} isA                       If the current block is an "A" or "B" block
 * @param  {Integer}  dayNumber                How many days into this block the current date is
 * @return {Object}                            Keys are service name (e.g., CCU),
 *                                                  values are position (e.g., A, Nights)
 */
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

/**
 * Get the regular expressions corresponding to the categories we will eventually return
 * @param  {DynamoDBDocumentClient} db           DB client
 * @param  {Object} offRotations                 Rotations that scheduled for an off day, keys are service, values are position
 * @return {Object}                              Keys are categories that the return object should mirror,
 *                                                    values are RegExps that should be used to test
 *                                                    assignments to determine whether an intern should
 *                                                    be grouped into the `key` category
 */
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

/**
 * Get rotations scheduled for an off day, except for Weinberg rotations
 * @param  {DynamoDBDocumentClient}  db        DB client
 * @param  {Boolean} isA                       If the current block is an "A" or "B" block
 * @param  {Integer}  dayNumber                How many days into this block the current date is
 * @return {Object}                            Keys are service name (e.g., The O, Brancati, CCU),
 *                                                  values are position (e.g., A, B, C, Nights)
 */
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

/**
 * Get Weinberg rotations scheduled for an off day
 * @param  {DynamoDBDocumentClient}  db        DB client
 * @param  {DayJS}  thisDay                    DayJS date object
 * @return {Object}                            Keys are service name (e.g., MTL, Leuks),
 *                                                  values are position (always Days for interns)
 */
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
    // Because WBG templates are in a different format, need to transform the output to an array
    // of Objects with `service` and `position` keys to match the format for the other rotations
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
