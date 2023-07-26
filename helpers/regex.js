/**
 * Build a consensus Regex expression given an array of expressions, will return null if no
 * expressions are passed in
 * @param  {Array} expressions Array of regular expressions
 * @return {Null|RegExp}       Either a RegExp object if some expressions are passed in or null
 */
export function tryBuildRegexForServices(expressions) {
    return expressions?.length > 0 ? new RegExp(`(?:${expressions.join("|")})`, "i") : null;
}
