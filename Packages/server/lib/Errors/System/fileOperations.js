const FileOperations = {
    "CALLER-DIRECTORY-NOT-FOUND": {
        status: 404,
        context: "The caller directory was not found",
        errorCode: "CALLER-DIRECTORY-NOT-FOUND",
        fault: "CLIENT",
        solutions: ["Verify the directory path and try again"]
    },
    "PERMISSION-DENIED": {
        status: 403,
        context: "Permission denied for the requested file operation",
        errorCode: "PERMISSION-DENIED",
        fault: "CLIENT",
        solutions: ["Ensure you have the necessary permissions for this operation"]
    },
    "DIRECTORY-NOT-FOUND": {
        status: 404,
        context: "The requested directory was not found",
        errorCode: "DIRECTORY-NOT-FOUND",
        fault: "CLIENT",
        solutions: ["Verify the directory path and try again"]
    },
    "WRITE-OPERATION-FAILED": {
        status: 500,
        context: "The write operation has failed",
        errorCode: "WRITE-OPERATION-FAILED",
        fault: "SERVER",
        solutions: ["Try again in 10 minutes and contact support if the issue persists"]
    },
    "FILE-NOT-FOUND": {
        status: 404,
        context: "The requested file was not found",
        errorCode: "FILE-NOT-FOUND",
        fault: "CLIENT",
        solutions: ["Verify the file path and try again"]
    },
    "READ-OPERATION-FAILED": {
        status: 500,
        context: "The read operation has failed",
        errorCode: "READ-OPERATION-FAILED",
        fault: "SERVER",
        solutions: ["Try again in 10 minutes and contact support if the issue persists"]
    }
};

export { FileOperations };

