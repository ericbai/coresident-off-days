/**
 * Classify residents according to the shape of the object of regular expressions
 * @param  {Object} regExpInfo Keys are categories that the return object should mirror,
 *                                 values are RegExp used to test membership
 * @param  {Object} schedules  Keys are intern names, values are assignments (e.g., CCU - A, Janeway - B)
 * @return {Object}            Keys are same as `regExpInfo`, values are arrays of objects with keys
 *                                  `intern` and `assignment` whose assignment matched the RegExp
 */
export function classifySchedulesByStatus(regExpInfo, schedules) {
    const classifiedSchedules = Object.create(null);
    // for each category (e.g., off, maybe off) and corresponding regular expression...
    for (const [category, regex] of Object.entries(regExpInfo)) {
        const matchedSchedules = [];
        // ...loop through all interns and assigments and...
        for (const [intern, assignment] of Object.entries(schedules)) {
            //...if the assignment matches the corresponding RegExp then add this intern to this category
            if (regex.test(assignment)) {
                matchedSchedules.push({ intern, assignment });
            }
        }
        // once finished iterating, store the matched intern schedules under the same category as
        // the original `regExpInfo` object
        classifiedSchedules[category] = matchedSchedules;
    }
    return classifiedSchedules;
}
