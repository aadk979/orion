const Notifications = {
    'NOTIFICATIONS::NO-IDS::A::p': {
        status: 400,
        context: 'No notification ids were supplied to acknowledge',
        errorCode: 'NOTIFICATIONS::NO-IDS::A::p',
        fault: 'CLIENT',
        solutions: ['Send the ids of the notifications that were displayed']
    },
    'NOTIFICATIONS::LOOKUP-FAILED::A::i': {
        status: 500,
        context: 'Notifications could not be read for this account',
        errorCode: 'NOTIFICATIONS::LOOKUP-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['NONE']
    },
    'NOTIFICATIONS::UPDATE-FAILED::A::i': {
        status: 500,
        context: 'The notification state could not be updated',
        errorCode: 'NOTIFICATIONS::UPDATE-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['NONE']
    }
};

export { Notifications };
