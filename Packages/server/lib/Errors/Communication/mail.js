const Mail = {
    "UNABLE-TO-SEND-MAIL": {
        status: 500,
        context: "Unable to send email due to server error",
        errorCode: "UNABLE-TO-SEND-MAIL",
        fault: "SERVER",
        solutions: ["Try again in 10 minutes and contact support if the issue persists"]
    }
};

export { Mail };
