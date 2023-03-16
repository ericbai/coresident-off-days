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
            `The date must be between ${minDay.format(displayFormat)} and ${maxDay.format(
                displayFormat
            )} (inclusive)`
        );
    }
    return day;
}
