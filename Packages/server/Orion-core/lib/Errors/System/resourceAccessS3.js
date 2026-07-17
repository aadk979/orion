const ResourceAccessS3 = {
    'RAS-S3::CALLBACK-FAILED::A::i': {
        status: 500,
        context: 'The registered S3 resource callback reported a failure while producing a resource URL',
        errorCode: 'RAS-S3::CALLBACK-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'RAS-S3::INVALID-URL::A::i': {
        status: 500,
        context: 'The registered S3 resource callback returned a missing or malformed resource URL',
        errorCode: 'RAS-S3::INVALID-URL::A::i',
        fault: 'SERVER',
        solutions: ['Ensure the resource access callback returns { url } with a valid http(s) URL']
    }
};

export { ResourceAccessS3 };
