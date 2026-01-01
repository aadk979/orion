const UserControl = {
    'USER-CONTROL-NO-EMAIL-PROVIDED': {
        status: 400,
        context: 'No email was provided for user control operation',
        errorCode: 'USER-CONTROL-NO-EMAIL-PROVIDED',
        fault: 'CLIENT',
        solutions: ['Provide a valid email address']
    },
    'USER-CONTROL-NO-UID-PROVIDED': {
        status: 400,
        context: 'No user ID was provided for user control operation',
        errorCode: 'USER-CONTROL-NO-UID-PROVIDED',
        fault: 'CLIENT',
        solutions: ['Provide a valid user ID']
    },
    'USER-CONTROL-NO-SUCH-USER': {
        status: 404,
        context: 'No user was found with the provided identifier',
        errorCode: 'USER-CONTROL-NO-SUCH-USER',
        fault: 'CLIENT',
        solutions: ['Verify the user identifier and try again']
    },
    'USER-CONTROL-NO-USER-ROLE-PROVIDED': {
        status: 400,
        context: 'No user role was provided for user control operation',
        errorCode: 'USER-CONTROL-NO-USER-ROLE-PROVIDED',
        fault: 'CLIENT',
        solutions: ['Provide a valid user role']
    },
    'USER-CONTROL-NOT-STANDARD-ROLE': {
        status: 400,
        context: 'The provided role is not a standard role',
        errorCode: 'USER-CONTROL-NOT-STANDARD-ROLE',
        fault: 'CLIENT',
        solutions: ['Use a standard role or enable custom roles']
    },
    'USER-CONTROL-CUSTOM-ROLES-ALLOWED-BUT-NOT-CONFIGURED': {
        status: 500,
        context: 'Custom roles are allowed but not configured on the server',
        errorCode: 'USER-CONTROL-CUSTOM-ROLES-ALLOWED-BUT-NOT-CONFIGURED',
        fault: 'SERVER',
        solutions: ['Configure custom roles in server settings or contact support']
    },
    'USER-CONTROL-ROLE-NOT-FOUND-IN-CUSTOM-ROLE-CONFIGURATION': {
        status: 400,
        context: 'The provided role was not found in the custom role configuration',
        errorCode: 'USER-CONTROL-ROLE-NOT-FOUND-IN-CUSTOM-ROLE-CONFIGURATION',
        fault: 'CLIENT',
        solutions: ['Use a role that exists in the custom role configuration']
    }
};

export { UserControl };
