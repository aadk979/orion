# 🛰️ Orion Alpine (v1.0.7 Beta)

Orion Alpine is a modern, production-ready authentication framework built for Node.js.  
It provides a secure, modular, and scalable foundation for authentication, authorization, and user management — from simple web apps to enterprise-grade systems.

> ⚠️ This is a **beta release** (v1.0.0). Expect updates, patches, and improvements as Orion undergoes live testing via the **SP Forms** project.

---

## 🚀 Installation

```bash
npm install @aadharsh/orion-alpine-x934x
```

## Usage

Import the initiateServer function from the library and call it with the start config and system config

A typical config file should look like this:

```bash
const callback = (req, res) => {
    res.send("Authenticated endpoint hit!");
    res.end();
    return;
}

const configuration = {
    PORT: 3495,
    appName: "Orion Test",
    serviceID: "699aeb89-f221-489f-9fce-dbe972386137",
    status: "DEV",
    logToFile: true,
    auditTrailSystem: {
        enabled: true
    },
    db: {
        provider: "FIRESTORE",
        credentials: {
            // The credentials your chosen db provider requires
        }
    },
    api: {
        customHeaders: [

        ],
        customEndpoints: [
            { path: "/p", requireAuth: true, method: "GET", callback },
            { path: "/api/my-endpoint-public-data", requireAuth: true, method: "GET", callback }
        ],
        customeMiddlewares: [
            { applyAll: true, callback: (req, res, next) => { console.log("Custom Middleware Executed"); next(); } },
            { applyAll: false, pathsToApply: ["/p"], callback: (req, res, next) => { console.log("Custom Middleware for User Data Executed"); next(); } }
        ]
    },
    client: {
        urls: ["http://localhost:5502", "http://localhost:5173"],
    },
    server: {
        urls: ["http://localhost:3495", "Other server urls"],
        myUrl: "http://localhost:3495"
    },
    mail: {
        email: "example@mail.com",
        password: "Password",
        service: "service"
    },
    tokens: {
        lifespans: {
            accessTokens: "15m",
            refreshTokens: "7d"
        }
    },
    authMethods: {
        emailPassword: true,
        passkey: true,
        oAuth: {
            google: {
                clientId: "",
                clientSecret: "",
                redirectUri: "http://localhost:5502/auth/google/callback"
            }
        },
        allowedEmailDomains: [ "*" ]
    },
    systemSecurity: {
        deviceAuthorization: "ENABLED",
        dip: "ENABLED",
        captcha: "ENABLED"
    }
}

export { configuration };
```
