/**
 * Building the `blockInfo` object
 * @param  {DayJs} thisDay    DayJS object
 * @param  {String} blockName Block name (e.g., 2A, 2B)
 * @param  {String} startDate String in the `YYYY-MM-DD` format
 * @return {Object}           BlockInfo object`
 */
export function buildBlockInfo(thisDay, blockName, startDate) {
    return {
        blockName: blockName,
        isA: blockName?.includes("A"),
        dayNumber: thisDay?.diff(startDate, "day") + 1,
    };
}

/**
 * Gets block name from BlockInfo
 * @param  {Object} blockInfo Object built by the `buildBlockInfo` function
 * @return {String}           Block's name (2A, 2B)
 */
export function getBlockNameFromBlockInfo(blockInfo) {
    return blockInfo?.blockName;
}

/**
 * Gets whether or not this is an "A" block
 * @param  {Object} blockInfo Object built by the `buildBlockInfo` function
 * @return {Boolean}          Whether or not this an "A" block
 */
export function getIsAFromBlockInfo(blockInfo) {
    return blockInfo?.isA;
}

/**
 * Gets the day number, that is whether it is day 1 through 14 of the 2 week block
 * @param  {Object} blockInfo Object built by the `buildBlockInfo` function
 * @return {Number}           Which number day of the block it is (1 through 14, 2 week blocks)
 */
export function getDayNumberFromBlockInfo(blockInfo) {
    return blockInfo?.dayNumber;
}
