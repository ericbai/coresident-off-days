import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { buildBlockInfo } from "./block-info.js";
import { tryBuildRegexForServices } from "./regex.js";
import StatusError from "./status-error.js";

/**
 * Gets basic information about a block given a date
 * @param  {DynamoDBDocumentClient} db      Db client
 * @param  {DayJS} thisDay                  DayJS object
 * @return {Object}                         Keys are roles, values are BlockInfo objects with
 *                                               keys `blockName`, `isA`, and `dayNumber`
 */
export async function getBlockInfoByRoleForDate(db, thisDay) {
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
    // may return 0 to 2 blocks, if 2 blocks, then one wlll be resident and one will be intern
    // The key of the block info is the actual role itself so we don't have to have knowledge
    // of specific roles within this function
    return blocks.reduce(
        (obj, thisBlock) => (
            (obj[thisBlock.role] = buildBlockInfo(
                thisDay,
                thisBlock?.block,
                thisBlock?.start_date
            )),
            obj
        ),
        Object.create(null)
    );
}

/**
 * Gets schedule assignments for a given block name
 * @param  {DynamoDBDocumentClient} db      DB client
 * @param  {String} role                    Role (intern or resident)
 * @param  {String} blockName               Block's name (e.g., 9A, 10B, etc)
 * @return {Object}                         Keys are names, values are objects with keys
 *                                               `SCHEDULE_KEY_ROLE` and` `SCHEDULE_KEY_ASSIGNMENT``
 */
export async function getSchedulesForRoleAndBlockName(db, role, blockName) {
    const params = {
        TableName: process.env.TABLE_SCHEDULES,
        ExpressionAttributeNames: {
            "#name": "name",
            "#role": "role",
            "#blockName": blockName,
        },
        FilterExpression: "#role = :role",
        ExpressionAttributeValues: {
            ":role": role,
        },
        ProjectionExpression: "#name,#blockName",
    };
    const { Items: schedules } = await db.send(new ScanCommand(params));
    return schedules.reduce(
        (obj, schedule) => (
            (obj[schedule.name] = {
                [process.env.SCHEDULE_KEY_ROLE]: role,
                [process.env.SCHEDULE_KEY_ASSIGNMENT]: schedule[blockName],
            }),
            obj
        ),
        Object.create(null)
    );
}

/**
 * Get rotations that have a schedule off day for a given date
 * @param  {DynamoDBDocumentClient}  db        DB client
 * @param  {DayJS}  thisDay                    DayJS date object
 * @param  {String} role                       Role (intern or resident)
 * @param  {Boolean} isA                       If the current block is an "A" or "B" block
 * @param  {Integer}  dayNumber                How many days into this block the current date is
 * @return {Object}                            Object with keys `CLASSIFICATION_KEY_OFF` and
 *                                                    `CLASSIFICATION_KEY_MAYBE_OFF`, values are objects
 *                                                    with key as service names and values as positions
 */
export async function getRotationsByScheduledForRoleAndBlockInfo(
    db,
    thisDay,
    role,
    isA,
    dayNumber
) {
    const [rotationsByScheduled, bvOffRotations] = await Promise.all([
        getOffAndMaybeOffRotationsForRole(db, role, isA, dayNumber),
        // only check Bayview templates if a resident (NOT for interns)
        role === process.env.ROLE_RESIDENT ? getBayviewOffRotations(db, thisDay) : null,
    ]);
    // Bayview doesn't have the `MAYBE` scheduled status so merge the Bayvew service/position object
    // into the off rotations object obtained from the main templates API call
    if (bvOffRotations) {
        rotationsByScheduled[process.env.CLASSIFICATION_KEY_OFF] = {
            ...rotationsByScheduled[process.env.CLASSIFICATION_KEY_OFF],
            ...bvOffRotations,
        };
    }
    return rotationsByScheduled;
}

/**
 * Get the regular expressions corresponding to the categories we will eventually return
 * @param  {DynamoDBDocumentClient} db           DB client
 * @param  {Object} rotationsByScheduled         Rotations by scheduled status (off, maybeOff), keys are
 *                                                    `CLASSIFICATION_KEY_OFF` and
 *                                                    `CLASSIFICATION_KEY_MAYBE_OFF`, values are objects
 *                                                    with key as service names and values as positions
 * @return {Object}                              Keys are categories that the return object should mirror,
 *                                                    values are RegExps that should be used to test
 *                                                    assignments to determine whether an intern or resident
 *                                                    should be grouped into the `key` category
 */
export async function getRegexForRotationsByScheduled(db, rotationsByScheduled) {
    // Pool together the service names from both `off` and `maybeOff`
    const offServices = Object.keys(rotationsByScheduled[process.env.CLASSIFICATION_KEY_OFF]),
        maybeOffServices = Object.keys(
            rotationsByScheduled[process.env.CLASSIFICATION_KEY_MAYBE_OFF]
        ),
        serviceExpParams = [...offServices, ...maybeOffServices].reduce(
            // One of the limitations of manually building out strings is that all keys used within
            // the DynamoDB expressions have to manually-created distinct names
            (obj, service, i) => ((obj[`:name${i}`] = service), obj),
            Object.create(null)
        ),
        params = {
            TableName: process.env.TABLE_SERVICE_REGEX,
            FilterExpression: `service IN (${Object.keys(serviceExpParams).join(", ")})`,
            ExpressionAttributeValues: serviceExpParams,
        };
    // run the built query
    const { Items: serviceRegexObjs } = await db.send(new ScanCommand(params));
    // build regular expressions by replacing expression placeholders in returned expression objects
    const offExpArray = [],
        maybeOffExpArray = [];
    for (const { service, expression } of serviceRegexObjs) {
        const isMaybeOff = maybeOffServices.includes(service),
            classificationKeyToUse = isMaybeOff
                ? process.env.CLASSIFICATION_KEY_MAYBE_OFF
                : process.env.CLASSIFICATION_KEY_OFF,
            aggregator = isMaybeOff ? maybeOffExpArray : offExpArray;
        aggregator.push(
            expression.replaceAll(
                process.env.EXP_PLACEHOLDER_POSITION,
                rotationsByScheduled[classificationKeyToUse][service]
            )
        );
    }
    // return Object with keys from CLASSIFICATION_KEY_* and values that guaranteed to be non-null
    // regular expressions, see https://stackoverflow.com/a/38340730
    return Object.fromEntries(
        Object.entries({
            [process.env.CLASSIFICATION_KEY_OFF]: tryBuildRegexForServices(offExpArray),
            [process.env.CLASSIFICATION_KEY_MAYBE_OFF]: tryBuildRegexForServices(maybeOffExpArray),
        }).filter(([key, regexOrNull]) => regexOrNull != null)
    );
}

// Helpers
// -------

/**
 * Get rotations scheduled for an off day, except for Bayview rotations
 * @param  {DynamoDBDocumentClient}  db        DB client
 * @param  {String} role                       Role (intern or resident)
 * @param  {Boolean} isA                       If the current block is an "A" or "B" block
 * @param  {Integer}  dayNumber                How many days into this block the current date is
 * @return {Object}                            Object with keys `CLASSIFICATION_KEY_OFF` and
 *                                                    `CLASSIFICATION_KEY_MAYBE_OFF`, values are objects
 *                                                    with key as service names and values as positions
 */
async function getOffAndMaybeOffRotationsForRole(db, role, isA, dayNumber) {
    const dayNumberColumn = String(dayNumber),
        params = {
            TableName: process.env.TABLE_TEMPLATES,
            ExpressionAttributeNames: {
                "#service": "service",
                "#position": "position",
                "#role": "role",
                "#scheduledForDayNumberOne": dayNumberColumn,
                "#scheduledForDayNumberTwo": dayNumberColumn,
                "#blockTypeOne": "block_type",
                "#blockTypeTwo": "block_type",
            },
            FilterExpression:
                "#role = :role And (#scheduledForDayNumberOne = :dayNumberOne Or #scheduledForDayNumberTwo = :dayNumberTwo) And (#blockTypeOne = :blockTypeOne Or #blockTypeTwo = :blockTypeTwo)",
            ExpressionAttributeValues: {
                ":role": role,
                ":dayNumberOne": process.env.SCHEDULED_OFF,
                ":dayNumberTwo": process.env.SCHEDULED_MAYBE_OFF,
                ":blockTypeOne": "Any",
                ":blockTypeTwo": isA ? "A" : "B",
            },
            // Doesn't matter if `scheduledForDayNumberOne` vs `scheduledForDayNumberTwo` since
            // they both reference the same column name
            ProjectionExpression: `#service,#position,#scheduledForDayNumberOne`,
        };
    const { Items: offOfMaybeOffRotations } = await db.send(new ScanCommand(params)),
        // Keys are service name (e.g., The O, Brancati, CCU) and values are position (e.g., A, B, C, Any)
        offRotations = Object.create(null),
        maybeOffRotations = Object.create(null);
    // `rotationObj` is an object where the keys are the projection columns and values are the row values
    for (const rotationObj of offOfMaybeOffRotations) {
        const aggregator =
            rotationObj[dayNumberColumn] === process.env.SCHEDULED_OFF
                ? offRotations
                : maybeOffRotations;
        aggregator[rotationObj.service] = rotationObj.position;
    }
    return {
        [process.env.CLASSIFICATION_KEY_OFF]: offRotations,
        [process.env.CLASSIFICATION_KEY_MAYBE_OFF]: maybeOffRotations,
    };
}

/**
 * Get Bayview rotations scheduled for an off day
 * @param  {DynamoDBDocumentClient}  db        DB client
 * @param  {DayJS}  thisDay                    DayJS date object
 * @return {Object}                            Keys are service name (Bayview ICU),
 *                                                  values are position (e.g., 1, 2, 3)
 */
async function getBayviewOffRotations(db, thisDay) {
    const params = {
        TableName: process.env.TABLE_TEMPLATES_BV,
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
        throw new StatusError(404, "Could not find any Bayview schedules for given date");
    }
    const bvTemplateForDay = templates[0],
        // Keys are service name (Bayview ICU) and values are position (1, 2, 3)
        bvOffRotations = Object.create(null);
    // The variable `dateOrPositionKey` is because the keys in this object are the column names
    // and in the schema the first column is the date and the subsequent columns are the positions
    // So we first find the column that has an "OFF" value and then that column definitely is a
    // position column NOT the date column
    for (const dateOrPositionKey of Object.keys(bvTemplateForDay)) {
        if (bvTemplateForDay[dateOrPositionKey] === process.env.SCHEDULED_OFF) {
            // BCCU and BMICU have the exact same schedules for a given date
            bvOffRotations[process.env.SERVICE_BAYVIEW_ICU] = dateOrPositionKey;
        }
    }
    return bvOffRotations;
}
