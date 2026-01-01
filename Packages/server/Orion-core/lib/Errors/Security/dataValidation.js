const DataValidation = {
    'DV-INVALID-DATA': {
        status: 400,
        context: 'The provided data is not valid for this endpoint',
        errorCode: 'DV-INVALID-DATA',
        fault: 'CLIENT',
        solutions: ['Ensure all incoming data is in the expected and proper format']
    }
};

export { DataValidation };
