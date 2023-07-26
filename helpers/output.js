import {
    getBlockNameFromBlockInfo,
    getDayNumberFromBlockInfo,
    getIsAFromBlockInfo,
} from "./block-info.js";
import {
    getRegexForRotationsByScheduled,
    getRotationsByScheduledForRoleAndBlockInfo,
    getSchedulesForRoleAndBlockName,
} from "./db.js";

/**
 * Build error object
 * @param  {String} message     Error message
 * @return {Object|String}      Error object in standard format
 */
export function buildError(message) {
    return message;
}

/**
 * Classify schedules into "off" vs "maybe off" vs "not sure"
 * @param  {DynamoDBDocumentClient}  db  DB client
 * @param  {DayJS}  thisDay              DayJS date object
 * @param  {String} role                 Role (intern or resident)
 * @param  {Object} blockInfo            Object built by the `buildBlockInfo` function
 * @return {Object}                      Keys "off", "maybeOff", "notSure"  (see CLASSIFICATION_KEY_* in `serverless.yml),
 *                                            values are arrays of objects with keys `name`, `role`, and `assignment`
 */
export async function classifySchedulesForRoleAndBlockInfo(db, thisDay, role, blockInfo) {
    // fetch schedules and rotations that have scheduled off day
    const [schedules, rotationsByScheduled] = await Promise.all([
            getSchedulesForRoleAndBlockName(db, role, getBlockNameFromBlockInfo(blockInfo)),
            getRotationsByScheduledForRoleAndBlockInfo(
                db,
                thisDay,
                role,
                getIsAFromBlockInfo(blockInfo),
                getDayNumberFromBlockInfo(blockInfo)
            ),
        ]),
        // build regex for each category (off vs maybe off) and group residents into these categories
        regExpInfo = await getRegexForRotationsByScheduled(db, rotationsByScheduled);
    return classifySchedulesByStatus(regExpInfo, schedules);
}

// Helpers
// -------

/**
 * Classify residents according to the shape of the object of regular expressions
 * @param  {Object} regExpInfo Keys are categories that the return object should mirror,
 *                                 values are RegExp used to test membership
 * @param  {Object} schedules  Keys are names, values are assignments (e.g., CCU - A, Janeway - B)
 * @return {Object}            Keys are same as `regExpInfo` plus "notSure" (see CLASSIFICATION_KEY_* in `serverless.yml)
 *                                  values are arrays of objects with keys `name`, `role`, and `assignment`
 */
function classifySchedulesByStatus(regExpInfo, schedules) {
    const classifiedSchedules = Object.keys(regExpInfo).reduce(
        (obj, classificationKey) => ((obj[classificationKey] = []), obj),
        Object.create(null)
    );
    // add a "not sure" classification key to catch the schedules that don't match anything
    classifiedSchedules[process.env.CLASSIFICATION_KEY_LIKELY_NOT_OFF] = [];
    // then, for each name and assignment...
    for (const [
        name,
        {
            [process.env.SCHEDULE_KEY_ROLE]: role,
            [process.env.SCHEDULE_KEY_ASSIGNMENT]: assignment,
        },
    ] of Object.entries(schedules)) {
        let classificationKeyToAddTo = process.env.CLASSIFICATION_KEY_LIKELY_NOT_OFF;
        //...loop through each classification key (e.g., off, maybe off) and corresponding regular expression...
        for (const [classificationKey, regex] of Object.entries(regExpInfo)) {
            //...if the assignment matches the corresponding RegExp then add to this classification key
            if (regex.test(assignment)) {
                classificationKeyToAddTo = classificationKey;
            }
        }
        // add to whatever classification key match or the default "not sure" classification
        classifiedSchedules[classificationKeyToAddTo].push({ name, role, assignment });
    }
    // Sort all matched schedules within a classification key by name in descending alphabetical order
    return Object.entries(classifiedSchedules).reduce(
        (obj, [classificationKey, matchedSchedules]) => (
            (obj[classificationKey] = sortSchedulesByName(matchedSchedules)), obj
        ),
        Object.create(null)
    );
}

/**
 * Sort an array of schedule objects alphabetically by their `name` key
 * @param  {Arrray} schedules Array of schedules
 * @return {Array}            New array of schedules sorted alphabetically by their `name` key
 */
function sortSchedulesByName(schedules) {
    // Note: `toSorted` is currently browser only and only supported in Node.JS 20+
    // see https://stackoverflow.com/a/76006439
    return [...schedules].sort(({ name: n1 }, { name: n2 }) => (n1 === n2 ? 0 : n1 > n2 ? 1 : -1));
}
