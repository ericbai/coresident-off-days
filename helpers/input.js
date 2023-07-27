import dayjs from "dayjs";
import StatusError from "./status-error.js";

/**
 * Validate that the passed-in date is a valid date and that it falls within the minimum
 * and maximum allowed dates
 * @param  {Date} date  Date object
 * @return {DayJS}      Validated DayJS object
 */
export function tryBuildDayFromDate(date) {
    const day = dayjs(date).startOf("day"),
        minDay = dayjs(process.env.BOUND_MIN_DATE),
        maxDay = dayjs(process.env.BOUND_MAX_DATE),
        displayFormat = process.env.FORMAT_DATE;
    if (!day.isValid()) {
        throw new StatusError(400, "The date is not valid");
    } else if (day.isBefore(minDay) || day.isAfter(maxDay)) {
        throw new StatusError(
            400,
            `The date must be between ${humanReadableMinDate()} and ${maxDay.format(
                displayFormat
            )}.`
        );
    }
    return day;
}

/**
 * The min date is an exclusive date (meaning that the first available date is the date AFTER the min date).
 * This is confusing for humans, so we add 1 day and then format to our standard format `
 * @return {String} Formatted min-date in standard format
 */
export function humanReadableMinDate() {
    return dayjs(process.env.BOUND_MIN_DATE).add(1, "day").format(process.env.FORMAT_DATE);
}
