import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import StatusError from "./status-error.js";

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
export async function getOffAndMaybeOffRotationsForRole(db, role, isA, dayNumber) {
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
            ProjectionExpression: `#service,#position,#${dayNumberColumn}`,
        };
    const { Items: offOfMaybeOffRotations } = await db.send(new ScanCommand(params)),
        // Keys are service name (e.g., The O, Brancati, CCU) and values are position (e.g., A, B, C, Any)
        offRotations = Object.create(null),
        maybeOffRotations = Object.create(null);
    // `rotationObj` is an object where the keys are the projection columns and values are the row values
    for (const rotationObj of offOfMaybeOffRotations) {
        const aggregator =
            rotationObj[dayNumberColumn] === process.SCHEDULED_OFF
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
export async function getBayviewOffRotations(db, thisDay) {
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
