export function classifySchedulesByStatus(regExpInfo, schedules) {
    const classifiedSchedules = Object.create(null);
    for (const [category, regex] of Object.entries(regExpInfo)) {
        const matchedSchedules = [];
        for (const [intern, assignment] of Object.entries(schedules)) {
            if (regex.test(assignment)) {
                matchedSchedules.push({ intern, assignment });
            }
        }
        classifiedSchedules[category] = matchedSchedules;
    }
    return classifiedSchedules;
}
