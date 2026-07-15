const DataValidation = {
    'DATA-VALIDATION::INVALID-DATA::A::p': {
        status: 400,
        context: 'The provided data is not valid for this endpoint',
        errorCode: 'DATA-VALIDATION::INVALID-DATA::A::p',
        fault: 'CLIENT',
        solutions: ['Ensure all incoming data is in the expected and proper format']
    }
};

export { DataValidation };
