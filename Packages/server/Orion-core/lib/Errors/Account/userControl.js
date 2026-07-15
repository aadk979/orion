const UserControl = {
    'USER-CONTROL::NO-EMAIL-PROVIDED::A::p': {
        status: 400,
        context: 'No email was provided for user control operation',
        errorCode: 'USER-CONTROL::NO-EMAIL-PROVIDED::A::p',
        fault: 'CLIENT',
        solutions: ['Provide a valid email address']
    },
    'USER-CONTROL::NO-UID-PROVIDED::A::p': {
        status: 400,
        context: 'No user ID was provided for user control operation',
        errorCode: 'USER-CONTROL::NO-UID-PROVIDED::A::p',
        fault: 'CLIENT',
        solutions: ['Provide a valid user ID']
    },
    'USER-CONTROL::NO-SUCH-USER::A::p': {
        status: 404,
        context: 'No user was found with the provided identifier',
        errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p',
        fault: 'CLIENT',
        solutions: ['Verify the user identifier and try again']
    },
    'USER-CONTROL::NO-ROLE-PROVIDED::A::p': {
        status: 400,
        context: 'No user role was provided for user control operation',
        errorCode: 'USER-CONTROL::NO-ROLE-PROVIDED::A::p',
        fault: 'CLIENT',
        solutions: ['Provide a valid user role']
    },
    'USER-CONTROL::NOT-STANDARD-ROLE::A::p': {
        status: 400,
        context: 'The provided role is not a standard role',
        errorCode: 'USER-CONTROL::NOT-STANDARD-ROLE::A::p',
        fault: 'CLIENT',
        solutions: ['Use a standard role or enable custom roles']
    },
    'USER-CONTROL::CUSTOM-ROLES-NOT-CONFIGURED::A::i': {
        status: 500,
        context: 'Custom roles are allowed but not configured on the server',
        errorCode: 'USER-CONTROL::CUSTOM-ROLES-NOT-CONFIGURED::A::i',
        fault: 'SERVER',
        solutions: ['Configure custom roles in server settings or contact support']
    },
    'USER-CONTROL::ROLE-NOT-FOUND-IN-CONFIG::A::p': {
        status: 400,
        context: 'The provided role was not found in the custom role configuration',
        errorCode: 'USER-CONTROL::ROLE-NOT-FOUND-IN-CONFIG::A::p',
        fault: 'CLIENT',
        solutions: ['Use a role that exists in the custom role configuration']
    },
    'USER-CONTROL::NO-PASSWORD-PROVIDED::A::p': {
        status: 400,
        context: 'No password was provided for the password update operation',
        errorCode: 'USER-CONTROL::NO-PASSWORD-PROVIDED::A::p',
        fault: 'CLIENT',
        solutions: ['Provide a valid password']
    }
};

export { UserControl };
