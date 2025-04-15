const { respondWithError, respondWithSuccess } = require("../../../Server/Response/response");
const { hashString } = require("../../CryptoFunctions");
const { globalAccessPoint } = require("../../GlobalAccessPoint");
const { sanitizeString } = require("../../Sanitizer");
const { tryCatch } = require("../../TryCatch");
const { isValidEmail, isPasswordSafe } = require("../../Validator");
const { generateUID } = require("../../valueGenerator");

const createAccount = async (email, password) => {
    const Function = async (parameters) => {
        const lowerCaseEmail = parameters.email.toLowerCase();

        const sanitizedEmail = sanitizeString(lowerCaseEmail);
        const sanitizedPassword = sanitizeString(parameters.password);

        const emailValid = isValidEmail(sanitizedEmail);

        if (!emailValid) {
            return { error: true, errorCode: "ACC-REG-INVALID-EMAIL" }
        }

        const user = await globalAccessPoint.db().getData("Users-email", sanitizedEmail);

        if (user.data !== undefined) {
            return { error: true, errorCode: "ACC-REG-ACC-EXISTS" };
        }

        const passwordStrong = isPasswordSafe(sanitizedPassword);

        if (!passwordStrong) {
            return { error: true, errorCode: "ACC-REG-PASSWORD-WEAK" }
        }

        const hashedPassword = await hashString(sanitizedPassword);
        const uid = generateUID(sanitizedEmail);

        const userObject = {
            credentials: {
                password: hashedPassword,
                passkey: {
                    exist: false
                },
                uid: uid,
                providers: [

                ]
            },
            security: {
                emailVerified: false,
                activeTokens: [

                ],
                twoFA: {
                    enabled: false
                },
                methods: [

                ]
            },
            profile: {
                fields: [

                ]
            },
            customData: {

            }
        }

        const userLinkObject = {
            email: sanitizedEmail,
            uid: uid
        }

        const userStorage = await globalAccessPoint.db().addData("Users" , uid , userObject);
        const userLinkStorage = await globalAccessPoint.db().addData("Users-email" , sanitizedEmail , userLinkObject);

        if(userStorage.error || userLinkStorage.error){
            return { error: true , errorCode: "ACC-REG-UNABLE-TO-CREATE-ACC" }
        }

        return { error: false , completed: true }
    }

    const parameters = {
        email: email,
        password: password
    }

    const result = await tryCatch(Function, true, parameters);

    return result;
}

const routeHandlerCreateAccount = async (request , response) => {
    console.log(request.cookies["ID$:COOKIE_KEY-sgR2AhNefdMscfK"])
    const packet = request.body.packet;

    const email = packet.email;
    const password = packet.password;

    const callback = await createAccount(email , password);

    if(callback.error) {
        return respondWithError(response , callback.errorCode)
    }

    return respondWithSuccess(response , 201 , callback);
}

module.exports = { createAccount , routeHandlerCreateAccount };