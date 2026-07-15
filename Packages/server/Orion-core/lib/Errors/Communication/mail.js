const Mail = {
    'MAIL::SEND-FAILED::A::i': {
        status: 500,
        context: 'Unable to send email due to server error',
        errorCode: 'MAIL::SEND-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists'],
        clientSafeErrorCode: 'GENERAL::UNKNOWN-ERROR::A::i'
    }
};

export { Mail };