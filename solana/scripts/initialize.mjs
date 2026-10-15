// Legacy public-network initializer is intentionally non-executable.
// V2 requires explicit bootstrap/governance roles, zero caps and paused funding.
// No production key loading, signing or broadcasting is provided by this helper.
throw new Error('Legacy initialization disabled. Use reviewed v2 instructions in an isolated validator; production deployment is not authorized.');
