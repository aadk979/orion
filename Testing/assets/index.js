fetch("https://opulent-dollop-97976wvp4jvjcgxr-3495.app.github.dev/point-break/api/v1/action/register-user", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Orion-Cross-Origin": "TRUE",
      "orion-fingerprint": "fingerprint",
      "orion-user-agent": navigator.userAgent,
    },
    body: JSON.stringify({packet: {
            email: "aadk979@gmail.com",
            password: "SecurePassword@1234"
    }})
  })
  .then(res => res.json())
  .then(data => console.log(data));

fetch("https://opulent-dollop-97976wvp4jvjcgxr-3495.app.github.dev/point-break/api/v1/action/sign-in-user", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Orion-Cross-Origin": "TRUE",
      "orion-fingerprint": "fingerprint",
      "orion-user-agent": navigator.userAgent,
    },
    body: JSON.stringify({packet: {
            email: "aadk979@gmail.com",
            password: "SecurePassword@1234"
    }})
  })
  .then(res => res.json())
  .then(data => console.log(data));