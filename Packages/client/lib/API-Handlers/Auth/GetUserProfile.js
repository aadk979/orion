async function getUserProfile({ Api, getAuthHeader, This }) {
    const authHeader = await getAuthHeader(true, 'ACCESS_BEARER');

    const res = await Api.fetch(
        `/${This.systemConfig.nameSpace}/api/v1/action/get-user-profile`,
        'POST',
        authHeader.authHead,
        {}
    );

    const data = await res.json();

    if (data.error) return { error: true, errorCode: data.errorData?.errorCode || 'CLIENT-PROFILE-FETCH-FAILED' };

    return { error: false, profile: data.data };
}

export { getUserProfile };
