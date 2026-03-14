import { respondWithSuccess } from '../../../Server/Response/response.js';

const routeHandlerResetCookies = async (request, response) => {
    const cookies = request.cookies;

    if (cookies && Object.keys(cookies).length > 0) {
        Object.keys(cookies).forEach(cookieName => {
            response.cookie(cookieName, '', { httpOnly: true, secure: true, sameSite: 'None', maxAge: 0, path: '/' });
            response.cookie(cookieName, '', { httpOnly: true, secure: true, sameSite: 'None', maxAge: 0, path: '/api' });
        });
    }

    const commonCookieNames = ['ACCESS_TOKEN', 'REFRESH_TOKEN', 'NO_AUTH_TOKEN'];

    commonCookieNames.forEach(cookieName => {
        response.cookie(cookieName, '', { httpOnly: true, secure: true, sameSite: 'None', maxAge: 0, path: '/' });
    });

    return respondWithSuccess(response, 200, { cookiesReset: true });
};

export { routeHandlerResetCookies };