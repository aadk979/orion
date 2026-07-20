import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { S3UrlBuilder, presignS3Url } from '../../../../Packages/server/Orion-core/lib/Utils/Core/ResourceAccessManagment/s3BasedResources/S3UrlBuilder.js';

// Signing itself is the AWS SDK's responsibility; these tests pin the ergonomics we
// own (addressing style, key templating, expiry math, validation) and that a
// well-formed SigV4 query URL comes out — not the exact signature bytes.
const CREDS = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
const SIGNING_DATE = new Date('2013-05-24T00:00:00Z');

const baseBuilder = () => new S3UrlBuilder().bucket('my-bucket').region('eu-west-1').key('some/key.pdf').credentials(CREDS).signingDate(SIGNING_DATE);

describe('S3UrlBuilder — unsigned build() host and path resolution', () => {
    test('defaults to virtual-hosted AWS addressing', () => {
        assert.equal(
            new S3UrlBuilder().bucket('my-bucket').region('eu-west-1').key('some/key.pdf').build(),
            'https://my-bucket.s3.eu-west-1.amazonaws.com/some/key.pdf'
        );
    });

    test('pathStyle() moves the bucket into the path on AWS', () => {
        assert.equal(
            new S3UrlBuilder().bucket('my-bucket').region('eu-west-1').key('some/key.pdf').pathStyle().build(),
            'https://s3.eu-west-1.amazonaws.com/my-bucket/some/key.pdf'
        );
    });

    test('a custom endpoint defaults to path-style (MinIO/localstack convention)', () => {
        assert.equal(new S3UrlBuilder().bucket('bucket').key('key.txt').endpoint('http://localhost:9000').build(), 'http://localhost:9000/bucket/key.txt');
    });

    test('virtualHosted() with a custom endpoint prefixes the bucket as a subdomain', () => {
        assert.equal(
            new S3UrlBuilder().bucket('bucket').key('key.txt').endpoint('https://accountid.r2.cloudflarestorage.com').virtualHosted().region('auto').build(),
            'https://bucket.accountid.r2.cloudflarestorage.com/key.txt'
        );
    });

    test('rejects non-http(s) endpoints', () => {
        assert.throws(() => new S3UrlBuilder().endpoint('ftp://example.com'), /http\(s\)/);
    });
});

describe('S3UrlBuilder — key templating', () => {
    test('resolves {dot.path} placeholders from token data and customData', () => {
        const url = new S3UrlBuilder().bucket('acme').key('users/{uid}/reports/{customData.reportId}.pdf').context({ uid: 'U1' }, { reportId: 'R9' }).build();
        assert.equal(url, 'https://acme.s3.us-east-1.amazonaws.com/users/U1/reports/R9.pdf');
    });

    test('URI-encodes resolved values inside the path', () => {
        const url = new S3UrlBuilder().bucket('acme').key('files/{customData.name}').context({}, { name: 'a b' }).build();
        assert.equal(url, 'https://acme.s3.us-east-1.amazonaws.com/files/a%20b');
    });

    test('throws on unresolved or non-scalar placeholders', () => {
        assert.throws(() => new S3UrlBuilder().bucket('acme').key('x/{missing}').context({}, {}).build(), /unresolved key placeholder "\{missing\}"/);
        assert.throws(() => new S3UrlBuilder().bucket('acme').key('x/{customData.obj}').context({}, { obj: {} }).build(), /unresolved key placeholder/);
    });

    test('throws when no context was provided at all', () => {
        assert.throws(() => new S3UrlBuilder().bucket('acme').key('x/{uid}').build(), /unresolved key placeholder/);
    });
});

describe('S3UrlBuilder — presign()', () => {
    test('produces a deterministic, well-formed SigV4 query URL for a fixed signing date', async () => {
        const first = await baseBuilder().presign();
        const second = await baseBuilder().presign();
        assert.equal(first.url, second.url);

        const u = new URL(first.url);
        assert.equal(u.host, 'my-bucket.s3.eu-west-1.amazonaws.com');
        assert.equal(u.pathname, '/some/key.pdf');
        assert.equal(u.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
        assert.match(u.searchParams.get('X-Amz-Credential'), /AKIAIOSFODNN7EXAMPLE\/20130524\/eu-west-1\/s3\/aws4_request/);
        assert.equal(u.searchParams.get('X-Amz-Date'), '20130524T000000Z');
        assert.equal(u.searchParams.get('X-Amz-Expires'), '900');
        assert.match(u.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
    });

    test('expiresAt is the signing date plus expiresIn, in unix seconds', async () => {
        const { expiresAt } = await baseBuilder().expiresIn(300).presign();
        assert.equal(expiresAt, Math.floor(SIGNING_DATE.getTime() / 1000) + 300);
    });

    test('response-* overrides are signed into the query and change the signature', async () => {
        const plain = await baseBuilder().presign();
        const tuned = await baseBuilder().responseContentDisposition('attachment; filename="r.pdf"').responseContentType('application/pdf').presign();
        const tunedUrl = new URL(tuned.url);
        assert.equal(tunedUrl.searchParams.get('response-content-disposition'), 'attachment; filename="r.pdf"');
        assert.equal(tunedUrl.searchParams.get('response-content-type'), 'application/pdf');
        assert.notEqual(tunedUrl.searchParams.get('X-Amz-Signature'), new URL(plain.url).searchParams.get('X-Amz-Signature'));
    });

    test('a session token flows through to the query string', async () => {
        const { url } = await baseBuilder()
            .credentials({ ...CREDS, sessionToken: 'SESSION/TOKEN+VALUE' })
            .presign();
        assert.equal(new URL(url).searchParams.get('X-Amz-Security-Token'), 'SESSION/TOKEN+VALUE');
    });

    test('requires credentials, bucket, key and a valid expiry', async () => {
        await assert.rejects(() => new S3UrlBuilder().bucket('valid-bucket').key('k').presign(), /credentials/);
        await assert.rejects(() => new S3UrlBuilder().key('k').credentials(CREDS).presign(), /bucket/);
        await assert.rejects(() => new S3UrlBuilder().bucket('valid-bucket').credentials(CREDS).presign(), /key/);
        await assert.rejects(() => baseBuilder().expiresIn(0).presign(), /expiresIn/);
        await assert.rejects(() => baseBuilder().expiresIn(604801).presign(), /expiresIn/);
    });

    test('build() works without credentials for public objects', () => {
        assert.equal(new S3UrlBuilder().bucket('pub').key('k.txt').build(), 'https://pub.s3.us-east-1.amazonaws.com/k.txt');
    });
});

describe('presignS3Url — one-shot options form', () => {
    test('produces the same URL as the fluent builder', async () => {
        const fluent = await baseBuilder().expiresIn(300).responseContentType('application/pdf').presign();
        const oneShot = await presignS3Url({
            bucket: 'my-bucket',
            region: 'eu-west-1',
            key: 'some/key.pdf',
            credentials: CREDS,
            expiresIn: 300,
            responseContentType: 'application/pdf',
            signingDate: SIGNING_DATE
        });
        assert.deepEqual(oneShot, fluent);
    });

    test('supports templating through tokenData/customData options', async () => {
        const { url } = await presignS3Url({
            bucket: 'acme',
            key: 'users/{uid}/f.txt',
            tokenData: { uid: 'U7' },
            credentials: CREDS,
            signingDate: SIGNING_DATE
        });
        assert.equal(new URL(url).pathname, '/users/U7/f.txt');
    });
});
