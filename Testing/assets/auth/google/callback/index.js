import { Orion } from "./orion.beta.sdk.js";

const orion = new Orion({
    serverUrl: 'http://localhost:3495',
    nameSpace: 'alpine',
    slug: '5e67a4b39b7eb57d04256d62e8501507ff1bcde498ff8d0951fb8f13a68efdf1'
});

async function yurrrr() {
    // Initialize Orion
    await orion.initialize();

    // Check for OAuth callback parameters in URL
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');

    console.log(urlParams, code, state);

    if (code && state) {
        // OAuth callback - handle the callback and sign user in
        console.log('OAuth callback detected, processing...');

        const callbackResult = await orion.handleOAuthCallback();

        if (callbackResult.error) {
            console.error('OAuth callback failed:', callbackResult.errorCode);
            alert('OAuth sign-in failed: ' + callbackResult.errorCode);
            return;
        }

        if (callbackResult.signedIn) {
            console.log('Successfully signed in via OAuth!');
            alert('Successfully signed in via Google OAuth!');
        }
    } else if (true) {
        // No OAuth parameters - check if user is already signed in
        const authState = await orion.authState(async ({ signedIn }) => {
            if (!signedIn) {
                console.log('User not signed in, initiating Google OAuth...');

                // Generate OAuth redirect URL for Google
                const redirectResult = await orion.generateOAuthRedirectURLAndRedirect('GOOGLE');

                if (redirectResult.error) {
                    console.error('Failed to generate OAuth redirect URL:', redirectResult.errorCode);
                    alert('Failed to initiate OAuth: ' + redirectResult.errorCode);
                    return;
                }
            } else {
                console.log('User is already signed in!');
            }
        });
    }
}

yurrrr();
