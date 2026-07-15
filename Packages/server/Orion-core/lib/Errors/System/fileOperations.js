const FileOperations = {
    'FILE-OPS::CALLER-DIRECTORY-NOT-FOUND::A::p': {
        status: 404,
        context: 'The caller directory was not found',
        errorCode: 'FILE-OPS::CALLER-DIRECTORY-NOT-FOUND::A::p',
        fault: 'CLIENT',
        solutions: ['Verify the directory path and try again']
    },
    'FILE-OPS::PERMISSION-DENIED::A::p': {
        status: 403,
        context: 'Permission denied for the requested file operation',
        errorCode: 'FILE-OPS::PERMISSION-DENIED::A::p',
        fault: 'CLIENT',
        solutions: ['Ensure you have the necessary permissions for this operation']
    },
    'FILE-OPS::DIRECTORY-NOT-FOUND::A::p': {
        status: 404,
        context: 'The requested directory was not found',
        errorCode: 'FILE-OPS::DIRECTORY-NOT-FOUND::A::p',
        fault: 'CLIENT',
        solutions: ['Verify the directory path and try again']
    },
    'FILE-OPS::WRITE-FAILED::A::i': {
        status: 500,
        context: 'The write operation has failed',
        errorCode: 'FILE-OPS::WRITE-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'FILE-OPS::FILE-NOT-FOUND::A::p': {
        status: 404,
        context: 'The requested file was not found',
        errorCode: 'FILE-OPS::FILE-NOT-FOUND::A::p',
        fault: 'CLIENT',
        solutions: ['Verify the file path and try again']
    },
    'FILE-OPS::READ-FAILED::A::i': {
        status: 500,
        context: 'The read operation has failed',
        errorCode: 'FILE-OPS::READ-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    }
};

export { FileOperations };
