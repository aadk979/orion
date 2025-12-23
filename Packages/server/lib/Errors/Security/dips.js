const Dip = {
    "DIP-DISABLED": {
        status: 503,
        context: "The dip system has been disabled",
        errorCode: "DIP-DISABLED",
        fault: "NEITHER",
        solutions: ["NONE"]
    },
    "DIP-STATE-BODY-DATA-PRESENT": {
        status: 400,
        context: "Based on the dip headers an empty body is expected but received a non empty body",
        errorCode: "DIP-STATE-BODY-DATA-PRESENT",
        fault: "CLIENT",
        solutions: ["NONE"]
    },
    "DIP-STATE-ID-HEADER-MISSING": {
        status: 400,
        context: "The dip headers were not set",
        errorCode: "DIP-STATE-ID-HEADER-MISSING",
        fault: "CLIENT",
        solutions: ["NONE"]
    },
    "DIP-TIMEDOUT-OR-ID-HEADER-INVALID": {
        status: 400,
        context: "The dip configuration has either expired or is invalid",
        errorCode: "DIP-TIMEDOUT-OR-ID-HEADER-INVALID",
        fault: "CLIENT",
        solutions: ["NONE"]
    },
    "DIP-STATE-IP-MISMATCH": {
        status: 400,
        context: "The ip range for the stored dip configuration does not match",
        errorCode: "DIP-STATE-IP-MISMATCH",
        fault: "CLIENT",
        solutions: ["NONE"]
    },
    "DIP-STATE-SIGNATURE-HEADER-MISSING": {
        status: 400,
        context: "The expected dip signature header is missing",
        errorCode: "DIP-STATE-SIGNATURE-HEADER-MISSING",
        fault: "CLIENT",
        solutions: ["NONE"],
    },
    "DIP-STATE-BODY-DATA-NOT-PRESENT": {
        status: 400,
        context: "Based on the dip headers a non empty body is expected but received an empty body",
        errorCode: "DIP-STATE-BODY-DATA-NOT-PRESENT",
        fault: "CLIENT",
        solutions: ["NONE"]
    },
    "DIP-STATE-MISSING-SALT": {
        status: 400,
        context: "The required dip salt is missing",
        errorCode: "DIP-STATE-MISSING-SALT",
        fault: "CLIENT",
        solutions: ["NONE"]
    },
    "DIP-STATE-MISSING-TIMESTAMP-TYPE-1": {
        status: 400,
        context: "The required dip timestamp is missing",
        errorCode: "DIP-STATE-MISSING-TIMESTAMP-TYPE-1",
        fault: "CLIENT",
        solutions: ["NONE"]
    },
    "DIP-STATE-MISSING-TIMESTAMP-TYPE-2": {
        status: 400,
        context: "The required dip timestamps sub unix value is missing",
        errorCode: "DIP-STATE-MISSING-TIMESTAMP-TYPE-2",
        fault: "CLIENT",
        solutions: ["NONE"]
    },
    "DIP-STATE-SIGNATURE-MISMATCH": {
        status: 400,
        context: "The provided dip signature and generated one do not match",
        errorCode: "DIP-STATE-SIGNATURE-MISMATCH",
        fault: "CLIENT",
        solutions: ["NONE"]
    }
}

export { Dip }